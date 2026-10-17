package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.Text.Json
import System.Text.RegularExpressions

internal class ApiResponse {
    internal var Status int32
    internal var Body string = ""
    internal var ETag string = ""
    internal var RetryAfter string = ""
    internal var Remaining string = ""
    internal var Reset string = ""
    internal var Date string = ""
    internal var PollInterval string = ""

    shared {
        internal const UnauthorizedStatus int32 = 401

        internal const ForbiddenStatus int32 = 403

        internal const NotFoundStatus int32 = 404

        internal const NotModifiedStatus int32 = 304

        internal const RateLimitedStatus int32 = 429

        internal const SuccessStatusMinimum int32 = 200

        internal const SuccessStatusExclusiveLimit int32 = 300

        internal const ServerErrorStatusMinimum int32 = 500

        internal const ServerErrorStatusMaximum int32 = 599

        private const ValidStatusMinimum int32 = 100

        private const ValidStatusMaximum int32 = 599

        private const FailureReasonCharacterLimit int32 = 1024

        private const MaximumUnixTimestampSeconds int64 = 253402300799

        private const DefaultRateLimitDelaySeconds float64 = 60.0
    }

    internal init(output string) {
        let normalized = output.Replace("\r\n", "\n")
        let end = normalized.IndexOf("\n\n", StringComparison.Ordinal)

        if end < 0 {
            return
        }

        let lines = normalized.Substring(0, end).Split('\n')
        let status = lines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries)

        if status.Length < 2 || !status[0].StartsWith("HTTP/") || !Int32.TryParse(status[1], out Status) ||
            Status < ValidStatusMinimum ||
            Status > ValidStatusMaximum {
            Status = 0
            return
        }

        for i in 1 ... lines.Length {
            let colon = lines[i].IndexOf(':')

            if colon < 1 {
                continue
            }

            let name = lines[i].Substring(0, colon).ToLowerInvariant()
            let value = lines[i].Substring(colon + 1).Trim()

            switch name {
                case "etag" {
                    ETag = value
                }
                case "retry-after" {
                    RetryAfter = value
                }
                case "x-ratelimit-remaining" {
                    Remaining = value
                }
                case "x-ratelimit-reset" {
                    Reset = value
                }
                case "date" {
                    Date = value
                }
                case "x-poll-interval" {
                    PollInterval = value
                }
            }
        }

        Body = normalized.Substring(end + 2)
    }

    internal func RateLimited() bool {
        if Status == RateLimitedStatus {
            return true
        }

        if Status != ForbiddenStatus {
            return false
        }

        if RetryAfter != "" || Remaining == "0" {
            return true
        }

        try {
            let message = J.Text(J.Parse(Body), "message").ToLowerInvariant()
            return message.Contains("rate limit") || message.Contains("abuse detection")
        } catch {
            return false
        }
    }

    internal func FailureReason() string {
        var reason = ""
        try {
            let value = J.Parse(Body)
            let messages = List[JsonElement]{J.Get(value, "message")}
            for error in J.Items(J.Get(value, "errors")) {
                messages.Add(J.Get(error, "message"))
            }
            for message in messages {
                if message.ValueKind != JsonValueKind.String {
                    continue
                }
                let text = Regex.Replace(
                    Output.Clean(message.GetString() ?? "").Replace('\n', ' ').Trim(),
                    "(?i)(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+|bearer\\s+[^\\s,;]+",
                    "[redacted]"
                )
                if text != "" {
                    reason += (reason == "" ? "": "; ") + text
                }
                if reason.Length > FailureReasonCharacterLimit {
                    return reason.Substring(
                        0,
                        Char.IsHighSurrogate(
                            reason[FailureReasonCharacterLimit - 1]
                        ) ? FailureReasonCharacterLimit - 1: FailureReasonCharacterLimit
                    )
                }
            }
        } catch { }
        return reason
    }

    internal func Delay(rateLimited bool) float64 {
        let now = DateTimeOffset.UtcNow
        var date DateTimeOffset
        let server = DateTimeOffset.TryParse(
            Date,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out date
        ) ? date: now
        var delay double
        var seconds double
        var supplied bool

        if Double.TryParse(RetryAfter, NumberStyles.None, CultureInfo.InvariantCulture, out seconds) && Double.IsFinite(
            seconds
        ) &&
            seconds >= 0 {
            delay = seconds
            supplied = true
        } else if DateTimeOffset.TryParse(
            RetryAfter,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out date
        ) {
            delay = Math.Max(0.0, (date - server).TotalSeconds)
            supplied = true
        }

        var reset int64
        if Remaining == "0" && Int64.TryParse(Reset, out reset) && reset >= 0 && reset <= MaximumUnixTimestampSeconds {
            delay = Math.Max(delay, Math.Max(0.0, (DateTimeOffset.FromUnixTimeSeconds(reset) - server).TotalSeconds))
            supplied = true
        }

        if rateLimited && !supplied {
            delay = DefaultRateLimitDelaySeconds
        }

        return delay
    }
}

internal class ApiCache {
    internal var ETag string = ""
    internal var Body string = ""
    internal var Bytes int64
}

internal class ApiDeadlineException : Exception {
    internal init() : base("Checks watch timeout reached") { }
}

internal class ApiTransport {
    shared {
        internal const DefaultDeadlineSeconds int32 = 30

        internal const MutationRecovery string = "A rerun repeats the same coordinator version. If that version caused the failure, the owner must update the coordinator. After fixing the cause, the owner reruns the failed coordinator workflow run in Actions. Each event processes only its triggering comment. Recorded UUIDs replay their outcome."

        private let Cache Dictionary[string, ApiCache] = map[string, ApiCache]{}

        private const CacheByteLimit int64 = 4 * 1024 * 1024

        private const CacheEntryLimit int32 = 64

        private const CacheEntryOverheadBytes int32 = 256

        private const ETagCharacterLimit int32 = 1024

        private const WeakETagPrefix string = "W/"

        private const RequestTimeoutSeconds float64 = 60.0

        private const ReadAttemptLimit int32 = 3

        private const MinimumPollSeconds float64 = 2.0

        private const MutationIntervalSeconds float64 = 1.0

        private var CacheBytes int64

        private let Clock Stopwatch = Stopwatch.StartNew()

        private var NextMutation double

        private var Reads int32

        private var Mutations int32

        private var ConditionalResponses int32

        private var Retries int32

        private var Deadline double = Double.PositiveInfinity

        private var NextPoll double

        private let Polls Dictionary[string, double] = map[string, double]{}

        private var NextRead double

        private func RemoveCached(key string) {
            var cached ApiCache
            if Cache.Remove(key, out cached) {
                CacheBytes -= cached.Bytes
            }
        }

        private func Remember(key string, response ApiResponse) {
            RemoveCached(key)

            if !ValidETag(response.ETag) || response.Body.Trim() == "" {
                return
            }

            let bytes = 2 * (Convert.ToInt64(response.Body.Length) + key.Length + response.ETag.Length) +
                CacheEntryOverheadBytes

            if bytes > CacheByteLimit {
                return
            }

            if Cache.Count >= CacheEntryLimit || CacheBytes + bytes > CacheByteLimit {
                Cache.Clear()
                CacheBytes = 0
            }

            Cache[key] = ApiCache{ETag: response.ETag, Body: response.Body, Bytes: bytes}
            CacheBytes += bytes
        }

        internal func BeginDeadline(seconds int32) {
            Deadline = Clock.Elapsed.TotalSeconds + seconds
            NextPoll = 0.0
            Polls.Clear()
        }

        internal func EndDeadline() {
            Deadline = Double.PositiveInfinity
        }

        internal func CheckDeadline() {
            if Clock.Elapsed.TotalSeconds >= Deadline {
                throw ApiDeadlineException()
            }
        }

        internal func PollWait(prefix string = "") {
            var next = NextPoll

            for poll in Polls {
                if poll.Key.StartsWith(prefix, StringComparison.Ordinal) {
                    next = Math.Max(next, poll.Value)
                }
            }

            Wait(Math.Max(MinimumPollSeconds, next - Clock.Elapsed.TotalSeconds))
        }

        internal func Settle() {
            Wait(MutationIntervalSeconds)
        }

        internal func Report() Dictionary[string, Object?] -> map[string, Object?]{
            "reads": Reads,
            "mutations": Mutations,
            "conditional_responses": ConditionalResponses,
            "retry_attempts": Retries
        }

        private func Wait(seconds float64) {
            CheckDeadline()

            if seconds > 0 {
                let until = Math.Min(Clock.Elapsed.TotalSeconds + seconds, Deadline)
                var remaining = until - Clock.Elapsed.TotalSeconds

                while remaining > 0 {
                    select {
                        case <- after(TimeSpan.FromSeconds(remaining)) { }
                    }

                    remaining = until - Clock.Elapsed.TotalSeconds
                }
            }

            CheckDeadline()
        }

        private func ValidETag(value string) bool {
            let start = value.StartsWith(WeakETagPrefix, StringComparison.Ordinal) ? WeakETagPrefix.Length: 0

            if value.Length < start +
                2 ||
                value.Length > ETagCharacterLimit ||
                value[start] != '"' ||
                value[value.Length - 1] != '"' {
                return false
            }

            for i in start + 1 ... value.Length - 1 {
                let character = value[i]
                if character < '!' || character > '~' || character == '"' {
                    return false
                }
            }

            return true
        }

        private func WeakETagMatch(left string, right string) bool {
            if !ValidETag(left) || !ValidETag(right) {
                return false
            }

            return String.Equals(
                left.StartsWith(WeakETagPrefix, StringComparison.Ordinal) ? left.Substring(WeakETagPrefix.Length): left,
                right.StartsWith(WeakETagPrefix, StringComparison.Ordinal) ? right.Substring(
                    WeakETagPrefix.Length
                ): right,
                StringComparison.Ordinal
            )
        }

        private func Failure(status int32, read bool, delay float64, body string = "") Exception {
            let reason = status == 0 ? "transport failure or missing response status": "HTTP " + status.ToString()
            var message = "GitHub " + (read ? "read": "mutation") + " failed (" + reason + "). "
            if body != "" {
                message += "GitHub reason: " + body + ". "
            }
            message += read ? "At most three attempts within 60 seconds are allowed.":
            "No automatic retry was made. The outcome may be uncertain; inspect remote state before retrying. For publication, use tokate submit --run with the saved run."

            if delay > 0 {
                let bounded = Math.Min(delay, (DateTimeOffset.MaxValue - DateTimeOffset.UtcNow).TotalSeconds - 1.0)
                let retry = DateTimeOffset.UtcNow.AddSeconds(bounded).ToString("u", CultureInfo.InvariantCulture)
                let seconds = Math.Ceiling(delay).ToString(CultureInfo.InvariantCulture)
                message += " Retry at or after " + retry + " (in " + seconds + " seconds)."
            }

            return CliFailure(
                status == ApiResponse.UnauthorizedStatus ? "authentication_required": "command_failed",
                message,
                status == ApiResponse.UnauthorizedStatus ? []string{"gh", "auth", "login"}: []string{},
                httpStatus: status
            )
        }

        private func RequestAllowance(timer Stopwatch, read bool, expires int64) float64 {
            CheckDeadline()

            if Clock.Elapsed.TotalSeconds < NextRead {
                let delay = NextRead - Clock.Elapsed.TotalSeconds
                if delay >= Deadline - Clock.Elapsed.TotalSeconds {
                    Wait(Deadline - Clock.Elapsed.TotalSeconds)
                }

                if delay >= RequestTimeoutSeconds - timer.Elapsed.TotalSeconds {
                    throw Failure(ApiResponse.RateLimitedStatus, read, delay)
                }

                Wait(delay)
            }

            if !read {
                while Clock.Elapsed.TotalSeconds < NextMutation {
                    Wait(NextMutation - Clock.Elapsed.TotalSeconds)
                }
            }

            var remaining = Math.Min(
                RequestTimeoutSeconds - timer.Elapsed.TotalSeconds,
                Deadline - Clock.Elapsed.TotalSeconds
            )
            if !read && expires > 0 {
                remaining = Math.Min(remaining, expires - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0)
                if remaining <= 0 {
                    throw Exception("Reservation expired before coordination mutation")
                }
            }

            if remaining <= 0 {
                CheckDeadline()
                throw Failure(0, read, 0.0)
            }

            return remaining
        }

        private func ObserveResponse(path string, response ApiResponse, read bool, limited bool) {
            if read {
                var poll double
                if Double.TryParse(response.PollInterval, NumberStyles.None, CultureInfo.InvariantCulture, out poll) &&
                    Double.IsFinite(poll) && poll >= 0 {
                    Polls[path] = Clock.Elapsed.TotalSeconds + poll
                }

                NextPoll = Math.Max(NextPoll, Clock.Elapsed.TotalSeconds + response.Delay(limited))
            }

            if limited || response.Remaining == "0" || response.RetryAfter != "" {
                NextRead = Math.Max(NextRead, Clock.Elapsed.TotalSeconds + response.Delay(limited))
            }
        }

        internal suspend func Request(
            path string,
            body Object?,
            method string,
            missing bool,
            expires int64 = 0
        ) JsonElement {
            let timer = Stopwatch.StartNew()
            let verb = (method == "" ? (body == nil ? "GET": "POST"): method).ToUpperInvariant()
            let read = verb == "GET" || path == "graphql"
            let input string? = body == nil ? nil: J.Write(body)
            let key = path + "\n" + input

            for attempt in 0 ... (read ? ReadAttemptLimit: 1) {
                let remaining = RequestAllowance(timer, read, expires)

                let args = List[string]{"api", "--include", "--hostname", GitHub.Hostname, "--method", verb, path}
                var cached ApiCache
                let conditional = read && Cache.TryGetValue(key, out cached)
                if conditional {
                    args.Add("-H")
                    args.Add("If-None-Match: " + cached.ETag)
                }

                if body != nil {
                    args.Add("--input")
                    args.Add("-")
                }

                if read {
                    Reads++
                    if attempt > 0 {
                        Retries++
                    }
                } else {
                    Mutations++
                }

                var result CommandResult = CommandResult{Code: 1}
                try {
                    result = Commands.Run(
                        "gh",
                        args.ToArray(),
                        input: input,
                        github: true,
                        milliseconds: Math.Max(1, Convert.ToInt32(Math.Floor(remaining * 1000.0)))
                    )
                } catch { }

                CheckDeadline()
                if !read {
                    NextMutation = Clock.Elapsed.TotalSeconds + MutationIntervalSeconds
                }

                let response = ApiResponse(result.Output)
                let limited = response.RateLimited()

                ObserveResponse(path, response, read, limited)

                if timer.Elapsed.TotalSeconds >= RequestTimeoutSeconds {
                    throw Failure(response.Status, read, response.Delay(limited), response.FailureReason())
                }

                if response.Status == ApiResponse.NotModifiedStatus {
                    ConditionalResponses++
                    if !conditional || (response.ETag != "" && !WeakETagMatch(response.ETag, cached.ETag)) {
                        throw Exception(
                            "GitHub returned HTTP 304 without a matching in-memory body. Read failed closed."
                        )
                    }

                    return J.Parse(cached.Body)
                }

                if response.Status == ApiResponse.NotFoundStatus && missing {
                    RemoveCached(key)
                    return JsonElement{}
                }

                let success = response.Status >= ApiResponse.SuccessStatusMinimum &&
                    response.Status < ApiResponse.SuccessStatusExclusiveLimit
                if success && (result.Code == 0 || path == "graphql") && !result.Truncated && !result.ReadFailed {
                    var value JsonElement
                    try {
                        value = response.Body.Trim() == "" ? JsonElement{}: J.Parse(response.Body)
                    } catch {
                        throw Failure(0, read, 0.0)
                    }

                    if read {
                        Remember(key, response)
                    }

                    return value
                }

                let retryable = response.Status == 0 ||
                    success ||
                    response.Status >= ApiResponse.ServerErrorStatusMinimum ||
                    limited
                let delay = Math.Max(response.Delay(limited), retryable ? Convert.ToDouble(attempt + 1): 0.0)

                if read && retryable && delay >= Deadline - Clock.Elapsed.TotalSeconds {
                    Wait(Deadline - Clock.Elapsed.TotalSeconds)
                }

                if !read ||
                    !retryable ||
                    attempt == ReadAttemptLimit - 1 ||
                    delay >= RequestTimeoutSeconds - timer
                    .Elapsed
                    .TotalSeconds {
                    throw Failure(response.Status, read, delay, response.FailureReason())
                }

                Wait(delay)
            }

            throw Failure(0, read, 0.0)
        }
    }
}

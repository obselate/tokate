package TokateDesktop

class DurationText {
    shared {
        func Format(minutes int32) string -> minutes < 60 ? minutes.ToString() + " min": (minutes / 60).ToString() + " h" + (minutes % 60 == 0 ? "": " " + (minutes % 60).ToString() + " min")
    }
}

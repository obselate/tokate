package Tokate

import Microsoft.Win32.SafeHandles
import System
import System.Collections.Generic
import System.IO
import System.Runtime.InteropServices
import System.Text
import System.Text.Json

@DllImport("libc", EntryPoint: "statx", SetLastError: true)
func RuntimeMetadataStat(directory int32, path string, flags int32, mask uint32, buffer[]byte) int32;

@DllImport("libc", EntryPoint: "open", SetLastError: true)
func RuntimeMetadataOpen(path string, flags int32) int32;

internal class CodexRuntime {
    shared {
        private const ProbeTimeoutSeconds int32 = 10

        private const ModelCatalogByteLimit int32 = 4 * 1024 * 1024

        private const PackageMetadataByteLimit int32 = 65536

        private const ElfHeaderByteSize int32 = 20

        private const ElfMagic0 byte = 127

        private const ElfMagic1 byte = 69

        private const ElfMagic2 byte = 76

        private const ElfMagic3 byte = 70

        private const Elf64Class byte = 2

        private const ElfLittleEndian byte = 1

        private const ElfX64Machine byte = 62

        internal func Capabilities(path string = "") Dictionary[string, HashSet[string]] {
            try {
                let executable = CodexRuntime.Resolve(path)
                let home = Path.Combine(Path.GetTempPath(), "tokate-models-" + Guid.NewGuid().ToString("N"))

                Directory.CreateDirectory(
                    home,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                )

                try {
                    let prefix = List[string]{
                        "-i",
                        "PATH=" + NixRuntime.SearchPath(NixRuntime.Tools("", []string{executable}).ToArray()),
                        "HOME=" + home,
                        "CODEX_HOME=" + home,
                        executable
                    }

                    let help = List[string](prefix)
                    help.AddRange([]string{"exec", "--help"})
                    let controls = Commands.Run(
                        LocalPaths.NeedSystemTool("env"),
                        help.ToArray(),
                        home,
                        seconds: ProbeTimeoutSeconds,
                        isolated: true
                    )

                    for flag in[]string{"--model", "--config"} {
                        if controls.Code != 0 || !controls.Output.Contains(flag) {
                            throw ExecutionFailure.Create(
                                "verification_failed",
                                "Native Codex does not expose the required explicit controls; no compatible pair"
                            )
                        }
                    }

                    let catalog = List[string](prefix)
                    catalog.AddRange([]string{"debug", "models", "--bundled"})
                    let result = Commands.Run(
                        LocalPaths.NeedSystemTool("env"),
                        catalog.ToArray(),
                        home,
                        seconds: ProbeTimeoutSeconds,
                        isolated: true
                    )
                    if result.Code != 0 {
                        throw ExecutionFailure.Create(
                            "verification_failed",
                            "Cannot verify offline Codex model/effort capabilities; availability is unknown"
                        )
                    }

                    let models = Dictionary[string, HashSet[string]](StringComparer.Ordinal)
                    let value = RequestData.Parse(result.Output, ModelCatalogByteLimit)

                    for model in J.Items(J.Get(value, "models")) {
                        let efforts = HashSet[string](StringComparer.Ordinal)

                        for level in J.Items(J.Get(model, "supported_reasoning_levels")) {
                            efforts.Add(J.Text(level, "effort"))
                        }

                        models[J.Text(model, "slug")] = efforts
                    }

                    return models
                } finally {
                    Directory.Delete(home, true)
                }
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "missing_tools")
            }
        }

        private func FileKind(path string, kind int32) {
            let status = [LocalPaths.MetadataByteSize]byte

            if RuntimeMetadataStat(
                LocalPaths.CurrentWorkingDirectory,
                path,
                LocalPaths.MetadataNoFollow,
                LocalPaths.MetadataTypeMask,
                status
            ) != 0 ||
                (BitConverter.ToUInt32(status, 0) & LocalPaths.MetadataTypeMask) == 0 ||
                (BitConverter.ToUInt16(status, LocalPaths.MetadataModeOffset) & LocalPaths.FileTypeMask) != kind {
                throw ExecutionFailure.Create(
                    "verification_failed",
                    "Managed runtime requires regular files and unlinked metadata directories"
                )
            }
        }

        private func Metadata(path string) JsonElement {
            var current = path
            var kind int32 = LocalPaths.RegularFileType

            while current != "" {
                FileKind(current, kind)
                current = Path.GetDirectoryName(current) ?? ""
                kind = LocalPaths.DirectoryFileType
            }

            let descriptor = RuntimeMetadataOpen(
                path,
                LocalPaths.OpenNoFollow | LocalPaths.OpenNonBlocking | LocalPaths.OpenCloseOnExec
            )
            if descriptor < 0 {
                throw ExecutionFailure.Create("verification_failed", "Cannot safely open package metadata")
            }

            using let handle = SafeFileHandle(IntPtr(descriptor), true)
            using let file = FileStream(handle, FileAccess.Read)
            if !file.CanSeek {
                throw ExecutionFailure.Create("verification_failed", "Package metadata must be a regular file")
            }

            using let reader = BinaryReader(file)
            let bytes = reader.ReadBytes(PackageMetadataByteLimit + 1)
            if bytes.Length > PackageMetadataByteLimit {
                throw ExecutionFailure.Create("verification_failed", "Package metadata exceeds its byte limit")
            }

            return RequestData.Parse(Encoding.UTF8.GetString(bytes), PackageMetadataByteLimit)
        }

        internal func Native(path string) bool {
            FileKind(path, LocalPaths.RegularFileType)
            using let file = File.OpenRead(path)
            let header = [ElfHeaderByteSize]byte

            return file.Read(header, 0, header.Length) == header.Length &&
                header[0] == ElfMagic0 &&
                header[1] == ElfMagic1 &&
                header[2] == ElfMagic2 &&
                header[3] == ElfMagic3 &&
                header[4] == Elf64Class &&
                header[5] == ElfLittleEndian &&
                header[18] == ElfX64Machine &&
                header[19] == 0 &&
                (
                File.GetUnixFileMode(path) & (
                    UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute
                )
            ) != 0
        }

        internal func Bubblewrap(executable string) string {
            try {
                let root = Directory.GetParent(executable)?.Parent?.FullName ?? ""
                let manifest = Path.Combine(root, "codex-package.json")
                if !File.Exists(manifest) && FileInfo(manifest).LinkTarget == nil {
                    return ""
                }

                let metadata = Metadata(manifest)
                if J.Number(metadata, "layoutVersion") != 1 || J.Text(metadata, "variant") != "codex" || J.Text(
                    metadata,
                    "entrypoint"
                ) != "bin/codex" ||
                    J.Text(metadata, "resourcesDir") != "codex-resources" || J.Text(metadata, "version") == "" ||
                    (
                    J.Text(metadata, "target") != "x86_64-unknown-linux-musl" && J.Text(
                        metadata,
                        "target"
                    ) != "x86_64-unknown-linux-gnu"
                ) ||
                    executable != Path
                    .Combine(root, "bin/codex") {
                    throw CliFailure(
                        "verification_failed",
                        "Unsupported standalone Codex package layout. Repair the selected installation."
                    )
                }

                let bubblewrap = Path.Combine(root, "codex-resources/bwrap")
                if !Native(bubblewrap) {
                    throw CliFailure(
                        "verification_failed",
                        "The selected Codex package has no executable native bubblewrap resource. Repair that installation."
                    )
                }

                return bubblewrap
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "missing_tools")
            }
        }

        internal func Resolve(path string = "") string {
            let selected = LocalPaths.Harness("codex", path)
            if selected == "" {
                throw CliFailure("missing_tools", "Install Codex and add codex to PATH.")
            }

            try {
                let executable = LocalPaths.CanonicalPath(selected)
                if Native(executable) {
                    return executable
                }

                let bin = Path.GetDirectoryName(executable) ?? ""
                let root = Path.GetDirectoryName(bin) ?? ""
                if Path.GetFileName(executable) != "codex.js" || Path.GetFileName(bin) != "bin" {
                    throw ExecutionFailure.Create("verification_failed", "Unsupported launcher")
                }

                let manifest = Metadata(Path.Combine(root, "package.json"))
                let version = J.Text(manifest, "version")
                if J.Text(manifest, "name") != "@openai/codex" || J.Text(
                    J.Get(manifest, "bin"),
                    "codex"
                ) != "bin/codex.js" ||
                    version == "" ||
                    J.Text(J.Get(manifest, "optionalDependencies"), "@openai/codex-linux-x64") !=
                "npm:@openai/codex@" + version + "-linux-x64" {
                    throw ExecutionFailure.Create("verification_failed", "Unsupported package metadata")
                }

                let nested = Path.Combine(root, "node_modules/@openai/codex-linux-x64")
                let sibling = Path.Combine(Path.GetDirectoryName(root) ?? "", "codex-linux-x64")
                let platform = Directory.Exists(nested) ? nested: sibling
                let metadata = Metadata(Path.Combine(platform, "package.json"))
                if J.Text(metadata, "name") != "@openai/codex" || J.Text(metadata, "version") != version +
                    "-linux-x64" {
                    throw ExecutionFailure.Create("verification_failed", "Unsupported platform package")
                }

                let native = LocalPaths.CanonicalPath(
                    Path.Combine(platform, "vendor/x86_64-unknown-linux-musl/bin/codex")
                )
                if !Native(native) {
                    throw ExecutionFailure.Create("verification_failed", "Missing native executable")
                }

                return native
            } catch (error Exception) when error is CliFailure ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw CliFailure(
                    "verification_failed",
                    "Unsupported managed Codex runtime layout: requires an executable Linux x64 native binary or @openai/codex bin/codex.js with its matching nested (or sibling) @openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex. No launcher is run to discover runtime files; no inference started."
                )
            }
        }
    }
}

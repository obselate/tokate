package Tokate

import System
import System.Collections.Generic
import System.Linq
import System.Text

internal class Completion {
    shared {
        private func Names() string -> String.Join(" ", Cli.Commands.Select(command -> command.Name))

        private func Quote(text string) string -> text.Replace("\\", "\\\\").Replace("'", "\\'")

        private func Literals(command CliCommand) List[string] -> command
            .Kinds(true)
            .Concat(command.Kinds(false).Contains("HARNESS") ? Harness.Table.Keys.ToArray(): []string{})
            .ToList()

        private func Words(command CliCommand) string -> String.Join(
            " ",
            Literals(command).Concat(
                Cli.Options.Where(option -> command.Has(option.Name)).Select(option -> "--" + option.Name)
            )
        ) +
            " -h"

        internal func Script(shell string) string {
            let text = StringBuilder()

            if shell == "bash" {
                Bash(text)
            } else if shell == "zsh" {
                Zsh(text)
            } else if shell == "fish" {
                Fish(text)
            } else {
                throw Exception("Required shell: bash, zsh or fish")
            }

            return text.ToString()
        }

        private func Bash(text StringBuilder) {
            text.AppendLine("_tokate() {")
            text.AppendLine(
                "  local cur=$${COMP_WORDS[COMP_CWORD]} prev=$${COMP_WORDS[COMP_CWORD-1]} cmd=$${COMP_WORDS[1]} opts prefix='' i candidate"
            )
            text.AppendLine("  COMPREPLY=()")
            text.AppendLine(
                "  if (( COMP_CWORD == 1 )); then COMPREPLY=( $$(compgen -W '" +
                    Names() +
                    " --help -h' -- \"$$cur\") ); return; fi"
            )
            text.AppendLine("  case $$cmd in")
            text.AppendLine("    help) COMPREPLY=( $$(compgen -W '" + Names() + "' -- \"$$cur\") ); return ;;")

            for command in Cli.Commands {
                if command.Name != "help" {
                    text.AppendLine("    " + command.Name + ") opts='" + Words(command) + "' ;;")
                }
            }

            text.AppendLine("    *) return ;;\n  esac")
            text.AppendLine("  if [[ $$cur == --*=* ]]; then prefix=$${cur%%=*}=; prev=$${cur%%=*}; cur=$${cur#*=}; fi")
            text.AppendLine(
                "  if [[ $$prev == = ]] && (( COMP_CWORD > 1 )); then prev=$${COMP_WORDS[COMP_CWORD-2]}; fi"
            )
            text.AppendLine("  if [[ $$cur == = && $$prev == --* ]]; then cur=''; fi")
            text.AppendLine("  case $$prev in")

            for option in Cli.Options {
                if option.Value == "DIR" || option.Value == "FILE" {
                    text.AppendLine(
                        "    --" +
                            option.Name +
                            ") compopt -o filenames 2>/dev/null; while IFS= read -r candidate; do COMPREPLY+=(\"$$candidate\"); done < <(compgen -" +
                            (option.Value == "DIR" ? "d": "f") +
                            " -- \"$$cur\") ;;"
                    )
                } else if option.Choices != "" {
                    text.AppendLine(
                        "    --" +
                            option.Name +
                            ") COMPREPLY=( $$(compgen -W '" +
                            option.Choices +
                            "' -- \"$$cur\") ) ;;"
                    )
                }
            }

            text.AppendLine(
                "    " + String.Join(
                    "|",
                    Cli.Options.Where(option -> option.Value != "").Select(option -> "--" + option.Name)
                ) +
                    ") return ;;"
            )
            text.AppendLine("    *) COMPREPLY=( $$(compgen -W \"$$opts\" -- \"$$cur\") ) ;;\n  esac")
            text.AppendLine(
                "  if [[ -n $$prefix ]]; then for i in \"$${!COMPREPLY[@]}\"; do COMPREPLY[i]=$$prefix$${COMPREPLY[i]}; done; fi"
            )
            text.AppendLine("}\ncomplete -F _tokate tokate")
        }

        private func Zsh(text StringBuilder) {
            text.AppendLine("#compdef tokate\n_tokate() {\n  local context state line\n  typeset -A opt_args")
            text.AppendLine("  _arguments -C '1:command:->command' '*::argument:->args'")
            text.AppendLine(
                "  case $$state in\n    command) _values 'command' " +
                    Names() +
                    " --help -h ;;\n    args)\n      case $$line[1] in"
            )
            text.AppendLine("        help) _values 'command' " + Names() + " ;;")

            for command in Cli.Commands {
                if command.Name == "help" {
                    continue
                }

                text.Append("        " + command.Name + ") _arguments '-h[Show help]'")

                if Literals(command).Count > 0 {
                    text.Append(" '1:word:(" + String.Join(" ", Literals(command)) + ")'")
                }

                for option in Cli.Options {
                    if command.Has(option.Name) {
                        let action = option.Choices != "" ? "(" + option.Choices + ")":
                        (option.Value == "DIR" ? "_directories": "")
                        text.Append(
                            " '--" + option.Name + (option.Value == "" ? "": "=") + "[" + option.Describe(command.Name)
                                .Replace("'", "'\\''") +
                                "]" +
                                (option.Value == "" ? "": ":" + option.Value.Replace('|', '/') + ":" + action) +
                                "'"
                        )
                    }
                }

                text.AppendLine(" ;;")
            }

            text.AppendLine(
                "      esac ;;\n  esac\n}\nif [[ $$funcstack[1] == _tokate ]]; then _tokate \"$$@\"; else compdef _tokate tokate; fi"
            )
        }

        private func Fish(text StringBuilder) {
            text.AppendLine("complete -c tokate -f")
            text.AppendLine("complete -c tokate -n '__fish_use_subcommand' -l help -s h -d 'Show help'")
            text.AppendLine("complete -c tokate -n '__fish_use_subcommand' -l version -d 'Print installed version'")
            text.AppendLine("complete -c tokate -n '__fish_seen_subcommand_from help' -a '" + Names() + "'")

            for command in Cli.Commands.Where(command -> command.Name != "--version") {
                let seen = "complete -c tokate -n '__fish_seen_subcommand_from " + command.Name + "'"
                text.AppendLine(
                    "complete -c tokate -n '__fish_use_subcommand' -a '" +
                        command.Name +
                        "' -d '" +
                        Quote(command.Brief) +
                        "'"
                )

                if Literals(command).Count > 0 {
                    text.AppendLine(seen + " -a '" + String.Join(" ", Literals(command)) + "'")
                }

                for option in Cli.Options {
                    if command.Has(option.Name) {
                        text.AppendLine(
                            seen +
                                " -l " +
                                option.Name +
                                (option.Name == "help" ? " -s h": "") +
                                (option.Value == "" ? "": " -r") +
                                " -d '" +
                                Quote(option.Describe(command.Name)) +
                                "'" +
                                (
                                option.Choices != "" ? " -a '" + option.Choices + "'":
                                option.Value == "DIR" ? " -a '(__fish_complete_directories)'": ""
                            )
                        )
                    }
                }
            }
        }
    }
}

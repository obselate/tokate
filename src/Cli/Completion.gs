package Tokate

import System
import System.Collections.Generic
import System.Text

internal class Completion {
    shared {
        internal func Words(command string = "") string {
            let text = StringBuilder()

            if command == "" {
                for item in Cli.Commands {
                    text.Append(item.Name + " ")
                }

                text.Append("--help -h")
            } else {
                let selected = Cli.Find(command)

                for option in Cli.Options {
                    if selected.Has(option.Name) {
                        text.Append("--" + option.Name + " ")
                    }
                }

                text.Append("-h")
            }

            return text.ToString()
        }

        internal func Script(shell string) string {
            let text = StringBuilder()

            if shell == "bash" {
                text.AppendLine("_tokate() {")
                text.AppendLine(
                    "  local cur=$${COMP_WORDS[COMP_CWORD]} prev=$${COMP_WORDS[COMP_CWORD-1]} cmd=$${COMP_WORDS[1]} opts prefix='' i candidate"
                )
                text.AppendLine("  COMPREPLY=()")
                text.AppendLine(
                    "  if (( COMP_CWORD == 1 )); then COMPREPLY=( $$(compgen -W '" +
                        Words() +
                        "' -- \"$$cur\") ); return; fi"
                )
                text.AppendLine("  case $$cmd in")
                text.AppendLine("    help) COMPREPLY=( $$(compgen -W '" + Words() + "' -- \"$$cur\") ); return ;;")

                for command in Cli.Commands {
                    if command.Name == "help" {
                        continue
                    }

                    text.AppendLine(
                        "    " +
                            command.Name +
                            ") " +
                            (
                            Cli.Words(command.Name) == "" ? "":
                            "if (( COMP_CWORD == 2 )) && [[ $$cur != --* ]]; then COMPREPLY=( $$(compgen -W '" +
                                Cli.Words(command.Name) + "' -- \"$$cur\") ); return; fi; "
                        ) +
                            "opts='" +
                            Words(command.Name) +
                            "' ;;"
                    )
                }

                text.AppendLine("    *) return ;;\n  esac")
                text.AppendLine(
                    "  if [[ $$cur == --*=* ]]; then prefix=$${cur%%=*}=; prev=$${cur%%=*}; cur=$${cur#*=}; fi"
                )
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

                let values = StringBuilder()

                for option in Cli.Options {
                    if option.Value != "" {
                        values.Append((values.Length == 0 ? "": "|") + "--" + option.Name)
                    }
                }

                text.AppendLine("    " + values.ToString() + ") return ;;")
                text.AppendLine("    *) COMPREPLY=( $$(compgen -W \"$$opts\" -- \"$$cur\") ) ;;\n  esac")
                text.AppendLine(
                    "  if [[ -n $$prefix ]]; then for i in \"$${!COMPREPLY[@]}\"; do COMPREPLY[i]=$$prefix$${COMPREPLY[i]}; done; fi"
                )
                text.AppendLine("}\ncomplete -F _tokate tokate")
            } else if shell == "zsh" {
                text.AppendLine("#compdef tokate\n_tokate() {\n  local context state line\n  typeset -A opt_args")
                text.AppendLine("  _arguments -C '1:command:->command' '*::argument:->args'")
                text.AppendLine(
                    "  case $$state in\n    command) _values 'command' " +
                        Words() +
                        " ;;\n    args)\n      case $$line[1] in"
                )
                text.AppendLine("        help) _values 'command' " + Words() + " ;;")

                for command in Cli.Commands {
                    if command.Name == "help" {
                        continue
                    }

                    text.Append("        " + command.Name + ") _arguments '-h[Show help]'")

                    if Cli.Words(command.Name) != "" {
                        text.Append(" '1:word:(" + Cli.Words(command.Name) + ")'")
                    }

                    for option in Cli.Options {
                        if !command.Has(option.Name) {
                            continue
                        }

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

                    text.AppendLine(" ;;")
                }

                text.AppendLine(
                    "      esac ;;\n  esac\n}\nif [[ $$funcstack[1] == _tokate ]]; then _tokate \"$$@\"; else compdef _tokate tokate; fi"
                )
            } else if shell == "fish" {
                text.AppendLine("complete -c tokate -f")

                for command in Cli.Commands {
                    if command.Name == "--version" {
                        continue
                    }

                    text.AppendLine(
                        "complete -c tokate -n '__fish_use_subcommand' -a '" +
                            command.Name +
                            "' -d '" +
                            command
                            .Brief
                            .Replace("\\", "\\\\")
                            .Replace("'", "\\'") +
                            "'"
                    )

                    if command.Name == "help" {
                        text.AppendLine("complete -c tokate -n '__fish_seen_subcommand_from help' -a '" + Words() + "'")
                    }

                    if Cli.Words(command.Name) != "" {
                        text.AppendLine(
                            "complete -c tokate -n '__fish_seen_subcommand_from " + command.Name + "' -a '" + Cli.Words(
                                command.Name
                            ) +
                                "'"
                        )
                    }
                }

                for option in Cli.Options {
                    let groups = Dictionary[string, List[string]]()

                    for command in Cli.Commands {
                        if command.Name == "--version" || !command.Has(option.Name) {
                            continue
                        }

                        let description = option.Describe(command.Name)

                        if !groups.ContainsKey(description) {
                            groups[description] = List[string]()
                        }

                        groups[description].Add(command.Name)
                    }

                    for group in groups {
                        text.Append(
                            "complete -c tokate -n '__fish_seen_subcommand_from " + String.Join(" ", group.Value) +
                                "' -l " +
                                option.Name +
                                (option.Name == "help" ? " -s h": "") +
                                (option.Value == "" ? "": " -r") +
                                " -d '" +
                                group
                                .Key
                                .Replace("\\", "\\\\")
                                .Replace("'", "\\'") +
                                "'"
                        )

                        if option.Choices != "" {
                            text.Append(" -a '" + option.Choices + "'")
                        } else if option.Value == "DIR" {
                            text.Append(" -a '(__fish_complete_directories)' ")
                        }

                        text.AppendLine()
                    }
                }

                text.AppendLine("complete -c tokate -n '__fish_use_subcommand' -l help -s h -d 'Show help'")
                text.AppendLine("complete -c tokate -n '__fish_use_subcommand' -l version -d 'Print installed version'")
            } else {
                throw Exception("Required shell: bash, zsh or fish")
            }

            return text.ToString()
        }
    }
}

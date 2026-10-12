package TokateDesktop

import System
import System.Collections.Generic

/// The donor's saved profiles: list them, add or change one, and remove one. Tokate stores them.
class ProfileService {
    private let commands CommandRunner
    private let feedback FeedbackService
    private let dialogs DialogService
    private let window WindowService
    private let changed Action
    var Current ProfilesState = ProfilesState.Initial

    init(commands CommandRunner, feedback FeedbackService, dialogs DialogService, window WindowService, changed Action) {
        this.commands = commands
        this.feedback = feedback
        this.dialogs = dialogs
        this.window = window
        this.changed = changed
    }

    private func Set(next ProfilesState) {
        Current = next
        changed()
    }

    private func SetDraft(draft DonationDraft) -> Set(Current with{Draft = draft})

    func Enter() {
        Load("")
        go CheckHarnesses()
    }

    /// Finds the harnesses that are not set up. Runs on a worker, apart from the visible commands.
    private func CheckHarnesses() {
        let unready = HarnessDoctor.Unready()
        window.Post(() -> Set(Current with{Unready = unready}))
    }

    /// Reads the saved profiles, then shows `message`.
    private func Load(message string) {
        commands.Cli[[]DonorProfile](
            TokateCommands.DefaultsList(),
            DonorCodec.Profiles,
            (reply Reply[[]DonorProfile]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                Set(Current with{Profiles = reply.Value ?? []DonorProfile{}, Loaded = true})
                if message != "" {
                    feedback.Show(message, Tone.Done)
                }
            }
        )
    }

    private func LoadModels() {
        let harness = Current.Draft.Harness
        if harness == "codex" && Current.Models.Length == 0 {
            commands.Models(harness, models -> Set(Current with{Models = models}))
        }
        if harness == "omp" && Current.OmpModels.Length == 0 {
            commands.Models(harness, models -> Set(Current with{OmpModels = models}))
        }
    }

    func New() {
        feedback.Clear()
        Set(Current with{Open = true, Editing = "", Name = "", Draft = DonationDraft.Initial})
        LoadModels()
    }

    func Edit(profile DonorProfile) {
        feedback.Clear()
        Set(
            Current with{
                Open = true,
                Editing = profile.Name,
                Name = profile.Name,
                Draft = DonationDraft.Initial.UsingProfile(profile) with{Profile = ""},
            }
        )
        LoadModels()
    }

    func Cancel() {
        feedback.Clear()
        Set(Current with{Open = false})
    }

    func SetName(name string) -> Set(Current with{Name = name})

    func ChooseHarness(id string) {
        SetDraft(Current.Draft.ForHarness(id))
        LoadModels()
    }

    func SetProvider(provider string) -> SetDraft(Current.Draft with{Provider = provider, Model = "", Effort = ""})

    func SetModel(model string) -> SetDraft(Current.Draft.WithModel(model, Current.Catalog()))

    func SetEffort(effort string) -> SetDraft(Current.Draft with{Effort = effort})

    func SetEndpoint(endpoint string) -> SetDraft(Current.Draft with{Endpoint = endpoint})

    /// Saves the form. A saved profile with the same name is replaced.
    func Save() {
        let problem = Current.Problem()
        if problem != "" {
            feedback.Show(problem)
            return
        }
        let name = Current.Name.Trim()
        commands.Cli(
            TokateCommands.DefaultsSet(name, Current.Draft),
            (outcome CommandOutcome) -> {
                if !commands.Failed(outcome) {
                    Set(Current with{Open = false})
                    Load("Tokate saved the profile " + name + ".")
                }
            }
        )
    }

    func Remove(profile DonorProfile) {
        dialogs.Ask(
            Confirmation{
                Title: "Remove profile " + profile.Name,
                Text: "Tokate removes the saved profile. Saved work and reservations do not change.",
                ConfirmLabel: "Remove",
                Heading: "",
            },
            () -> commands.Cli(
                TokateCommands.DefaultsRemove(profile.Name),
                (outcome CommandOutcome) -> {
                    if !commands.Failed(outcome) {
                        Set(Current with{Open = Current.Open && Current.Editing != profile.Name})
                        Load("Tokate removed the profile " + profile.Name + ".")
                    }
                }
            )
        )
    }
}

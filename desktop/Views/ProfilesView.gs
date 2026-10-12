package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The donor's saved profiles, and the form that adds or changes one.
class ProfilesView {
    private let profiles ProfileService
    private let feedback FeedbackService
    private let art ArtworkService

    init(profiles ProfileService, feedback FeedbackService, art ArtworkService) {
        this.profiles = profiles
        this.feedback = feedback
        this.art = art
    }

    func Build(page PageContext) Blob {
        let state = profiles.Current
        let notice = feedback.Current
        let body = List[Blob]{
            Row{
                Children: []Blob{
                    Heading{Content: "Profiles", Size: AppTheme.DisplaySize}.Build(),
                    Spacer{}.Build(),
                    (page.Button with{Label = "New profile", Icon = "add", OnClick = () -> profiles.New(), Disabled = state.Open}).Build(),
                },
            }.Build(),
            Label{
                Content: "A profile saves a harness, model and reasoning effort on this computer. Select it in the limits of a donation, or set it as the default to start each donation with it. The owner of each repository decides which models are allowed.",
                Muted: true,
            }.Build(),
        }
        if notice.Message != "" {
            body.Add(Callout{Message: notice.Message, Tone: notice.Tone}.Build())
        }
        if notice.Report != "" {
            body.Add(ReportText{Content: notice.Report}.Build())
        }
        if state.Open {
            body.Add(Form(page, state))
        }
        if state.Profiles.Length > 0 {
            body.Add(
                ProfileList{
                    Profiles: state.Profiles,
                    Logo: id -> art.Logo(id).Render(),
                    Button: page.Button,
                    OnDefault: profile -> profiles.UseAsDefault(profile),
                    OnClearDefault: () -> profiles.ClearDefault(),
                    OnEdit: profile -> profiles.Edit(profile),
                    OnRemove: profile -> profiles.Remove(profile),
                }.Build()
            )
        } else if state.Loaded && !state.Open {
            body.Add(EmptyMessage{Content: "No saved profiles. Select \"New profile\" to save one.", Icon: "tune"}.Build())
        }
        return Stack{Gap: 20, Children: body.ToArray()}.Build()
    }

    private func Form(page PageContext, state ProfilesState) Blob {
        let draft = state.Draft
        return Panel{
            Compact: page.CompactPanels,
            Name: "Profile settings",
            Children: []Blob{
                Heading{Content: state.Editing != "" ? "Change " + state.Editing: "New profile"}.Build(),
                InputField{
                    Label: "Profile name",
                    Controlled: true,
                    Value: state.Name,
                    OnChange: name -> profiles.SetName(name),
                    Placeholder: "A short name",
                    Width: 230,
                    Disabled: page.Busy || state.Editing != "",
                }.Build(),
                HarnessPicker{
                    Selected: draft.Harness,
                    Policy: Policy.Empty,
                    Unready: state.Unready,
                    Logo: id -> art.Logo(id).Render(),
                    Disabled: page.Busy,
                    OnChoose: id -> profiles.ChooseHarness(id),
                }.Build(),
                ModelPicker{
                    Harness: draft.Harness,
                    Provider: draft.Provider,
                    Providers: ModelChoice.Providers(state.OmpModels),
                    Model: draft.Model,
                    Effort: draft.Effort,
                    Endpoint: draft.Endpoint,
                    Models: state.Catalog(),
                    Efforts: state.Efforts(),
                    Disabled: page.Busy,
                    OnModel: value -> profiles.SetModel(value),
                    OnEffort: value -> profiles.SetEffort(value),
                    OnEndpoint: value -> profiles.SetEndpoint(value),
                    OnProvider: value -> profiles.SetProvider(value),
                    Popup: page.Popup,
                }.Build(),
                Row{
                    Children: []Blob{
                        (page.Button with{Label = "Save profile", OnClick = () -> profiles.Save(), Primary = true}).Build(),
                        (page.Button with{Label = "Cancel", Kind = ButtonKind.Quiet, OnClick = () -> profiles.Cancel()}).Build(),
                    },
                }.Build(),
            },
        }.Build()
    }
}

package TokateDesktop

import Goo
import System

/// One page of saved runs with pagination.
class SavedListView {
    private let saved SavedWorkService

    init(saved SavedWorkService) {
        this.saved = saved
    }

    /// The list's blocks, laid out directly in the page so the table can fill it.
    func Build(page PageContext) []Blob {
        let state = saved.Current
        let total = state.Paths.Length
        return []Blob{
            SavedTable{
                Rows: state.Rows,
                FirstIndex: (state.Page - 1) * IssueListing.PageSize,
                Total: total,
                Reading: state.Reading,
                Short: page.Metrics.Short,
                Narrow: page.NarrowContent,
                Disabled: page.Busy,
                Loader: page.Loader,
                OnOpen: item -> saved.Select(item),
            }.Build(),
            Pager{
                Button: page.Button,
                Page: state.Page,
                LastPage: state.LastPage,
                Summary: total.ToString() + (total == 1 ? " contribution": " contributions") + "  ·  Newest first",
                Narrow: page.NarrowContent,
                OnChange: number -> saved.LoadPage(number),
            }.Build(),
        }
    }
}

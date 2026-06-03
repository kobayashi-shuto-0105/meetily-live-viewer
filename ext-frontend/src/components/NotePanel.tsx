// ----------------------------------------------------------------
// NotePanel – Static glass note panel on the left side.
// ----------------------------------------------------------------

export function NotePanel() {
  return (
    <aside className="note-panel">
      <div className="note-panel-content">
        <p className="note-panel-title">Notes</p>
        <section className="note-overview">
          <h2>Meeting overview</h2>
          <p>
            A productive discussion on product direction, key takeaways, and next steps.
          </p>
        </section>

        <section className="note-block">
          <h3 className="note-block-heading">Key takeaways</h3>
          <ul className="note-list">
            <li>Users love the simplicity and speed.</li>
            <li>The onboarding flow needs refinement.</li>
            <li>AI summary feature is delivering value.</li>
            <li>More integrations requested.</li>
          </ul>
        </section>

        <section className="note-block">
          <h3 className="note-block-heading">Action items</h3>
          <div className="note-actions">
            <label><span />Refine onboarding flow <b>Alex</b></label>
            <label><span />Add calendar integration <b>Priya</b></label>
            <label><span />Share beta feedback with team <b>Jordan</b></label>
          </div>
        </section>

        <section className="note-block">
          <h3 className="note-block-heading">Next steps</h3>
          <p className="note-block-desc">
            Align on onboarding updates, prioritize integrations, and continue gathering feedback.
          </p>
        </section>
      </div>
    </aside>
  );
}

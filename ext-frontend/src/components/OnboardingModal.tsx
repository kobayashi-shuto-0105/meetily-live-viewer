import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { saveAuthorName } from "../stores/authorName";

const STEPS = ["name", "segments", "sections"] as const;
type Step = (typeof STEPS)[number];

interface Props {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const step: Step = STEPS[stepIndex];

  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const lastNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "name") lastNameRef.current?.focus();
  }, [step]);

  const isNameValid = lastName.trim() !== "" && firstName.trim() !== "";
  const isLast = stepIndex === STEPS.length - 1;

  const handleNameNext = useCallback(() => {
    if (!isNameValid) return;
    saveAuthorName(`${lastName.trim()} ${firstName.trim()}`);
    setStepIndex(1);
  }, [isNameValid, lastName, firstName]);

  const handleNameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); handleNameNext(); }
    },
    [handleNameNext]
  );

  const handleNext = useCallback(() => {
    if (isLast) onComplete();
    else setStepIndex((i) => i + 1);
  }, [isLast, onComplete]);

  const handleBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-modal" role="dialog" aria-modal="true">
        <StepDots total={STEPS.length} current={stepIndex} />

        {step === "name" && (
          <NameStep
            lastName={lastName}
            firstName={firstName}
            onLastName={setLastName}
            onFirstName={setFirstName}
            onKeyDown={handleNameKeyDown}
            onSubmit={handleNameNext}
            isValid={isNameValid}
            lastNameRef={lastNameRef}
          />
        )}

        {step === "segments" && (
          <SegmentsStep onBack={handleBack} onNext={handleNext} />
        )}

        {step === "sections" && (
          <SectionsStep onBack={handleBack} onNext={handleNext} />
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Step dots
// ----------------------------------------------------------------

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="ob-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`ob-dot${i === current ? " is-active" : ""}`} />
      ))}
    </div>
  );
}

// ----------------------------------------------------------------
// Step 1 — Name
// ----------------------------------------------------------------

interface NameStepProps {
  lastName: string;
  firstName: string;
  onLastName: (v: string) => void;
  onFirstName: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  isValid: boolean;
  lastNameRef: RefObject<HTMLInputElement>;
}

function NameStep({
  lastName, firstName, onLastName, onFirstName,
  onKeyDown, onSubmit, isValid, lastNameRef,
}: NameStepProps) {
  return (
    <div className="ob-step">
      <div className="ob-icon">👋</div>
      <h2 className="ob-title">Welcome to Meetily</h2>
      <p className="ob-desc">
        Enter your name so others can identify your comments in the transcript.
      </p>
      <div className="ob-name-fields">
        <label className="ob-field">
          <span>Last name</span>
          <input
            ref={lastNameRef}
            type="text"
            value={lastName}
            onChange={(e) => onLastName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Kobayashi"
            autoComplete="family-name"
          />
        </label>
        <label className="ob-field">
          <span>First name</span>
          <input
            type="text"
            value={firstName}
            onChange={(e) => onFirstName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Shuto"
            autoComplete="given-name"
          />
        </label>
      </div>
      <button
        type="button"
        className="ob-btn ob-btn-primary"
        onClick={onSubmit}
        disabled={!isValid}
      >
        Get started →
      </button>
    </div>
  );
}

// ----------------------------------------------------------------
// Step 2 — Segment editing
// ----------------------------------------------------------------

function SegmentsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="ob-step">
      <div className="ob-icon">✏️</div>
      <h2 className="ob-title">Edit & annotate segments</h2>
      <p className="ob-desc">
        Click any transcript segment to select it, then use keyboard shortcuts.
      </p>
      <div className="ob-shortcuts">
        <ShortcutRow keys="Enter" label="Edit segment text" />
        <ShortcutRow keys="⌘ Enter" label="Add a comment" />
        <ShortcutRow keys="T" label="Mark as TODO" accent="todo" />
        <ShortcutRow keys="F" label="Mark as FIXME" accent="fixme" />
        <ShortcutRow keys="Esc" label="Deselect" />
      </div>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next →" />
    </div>
  );
}

function ShortcutRow({
  keys,
  label,
  accent,
}: {
  keys: string;
  label: string;
  accent?: "todo" | "fixme";
}) {
  return (
    <div className="ob-shortcut-row">
      <kbd className="ob-kbd">{keys}</kbd>
      <span className={accent ? `ob-shortcut-label ob-accent-${accent}` : "ob-shortcut-label"}>
        {label}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------
// Step 3 — Sections
// ----------------------------------------------------------------

function SectionsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="ob-step">
      <div className="ob-icon">🗂️</div>
      <h2 className="ob-title">Organize with sections</h2>
      <p className="ob-desc">
        Hover between segments to reveal a <strong>+</strong> button.
        Click it to insert a section with a title and description.
      </p>
      <SectionPreview />
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Start using Meetily" isLast />
    </div>
  );
}

function SectionPreview() {
  return (
    <div className="ob-section-preview">
      <div className="ob-preview-segment">You know that.</div>
      <div className="ob-preview-insert">
        <span className="ob-preview-plus">+</span>
        <span className="ob-preview-line" />
      </div>
      <div className="ob-preview-header">
        <span className="ob-preview-pin">📌</span>
        <div className="ob-preview-header-text">
          <span className="ob-preview-header-title">Discussion</span>
          <span className="ob-preview-header-desc">Topic overview</span>
        </div>
      </div>
      <div className="ob-preview-segment">Let's keep the alternative version…</div>
    </div>
  );
}

// ----------------------------------------------------------------
// Shared nav
// ----------------------------------------------------------------

function StepNav({
  onBack,
  onNext,
  nextLabel,
  isLast,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  isLast?: boolean;
}) {
  return (
    <div className="ob-nav">
      <button type="button" className="ob-btn ob-btn-ghost" onClick={onBack}>
        ← Back
      </button>
      <button
        type="button"
        className={`ob-btn ${isLast ? "ob-btn-primary" : "ob-btn-primary"}`}
        onClick={onNext}
      >
        {nextLabel}
      </button>
    </div>
  );
}

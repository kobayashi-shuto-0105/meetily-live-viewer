import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { saveAuthorName } from "../stores/authorName";

interface Props {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Props) {
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const lastNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    lastNameRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const last = lastName.trim();
    const first = firstName.trim();
    if (!last || !first) return;
    saveAuthorName(`${last} ${first}`);
    onComplete();
  }, [lastName, firstName, onComplete]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const isValid = lastName.trim() !== "" && firstName.trim() !== "";

  return (
    <div className="onboarding-backdrop">
      <div
        className="onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div className="onboarding-icon">👋</div>
        <h2 id="onboarding-title" className="onboarding-title">
          Welcome to Meetily
        </h2>
        <p className="onboarding-desc">
          Enter your name to identify your comments in the transcript.
        </p>
        <div className="onboarding-fields">
          <label className="onboarding-field">
            <span>Last name</span>
            <input
              ref={lastNameRef}
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Kobayashi"
              autoComplete="family-name"
            />
          </label>
          <label className="onboarding-field">
            <span>First name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Shuto"
              autoComplete="given-name"
            />
          </label>
        </div>
        <button
          type="button"
          className="onboarding-btn"
          onClick={handleSubmit}
          disabled={!isValid}
        >
          Get started
        </button>
      </div>
    </div>
  );
}

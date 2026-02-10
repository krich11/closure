#!/usr/bin/env node
/**
 * Closure — Onboarding page (onboarding.js)
 * @version 1.3.2
 *
 * Multi-step first-run experience. No network calls.
 * Navigates between steps with simple show/hide.
 */

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupCloseButton();
});

/**
 * Wire up all next/prev buttons to navigate between steps.
 */
function setupNavigation() {
  document.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      goToStep(btn.dataset.next);
    });
  });

  document.querySelectorAll('[data-prev]').forEach(btn => {
    btn.addEventListener('click', () => {
      goToStep(btn.dataset.prev);
    });
  });
}

/**
 * Navigate to a specific step by ID.
 * Hides all other steps, shows the target, updates progress dots.
 */
function goToStep(stepId) {
  const allSteps = document.querySelectorAll('.step');
  const allDots = document.querySelectorAll('.dot');

  allSteps.forEach(step => {
    if (step.id === stepId) {
      step.hidden = false;
      step.classList.add('step--active');
      // Focus the heading for accessibility
      const heading = step.querySelector('h1, h2');
      if (heading) heading.focus();
    } else {
      step.hidden = true;
      step.classList.remove('step--active');
    }
  });

  allDots.forEach(dot => {
    dot.classList.toggle('dot--active', dot.dataset.step === stepId);
  });
}

/**
 * Close button marks onboarding complete and closes the tab.
 */
function setupCloseButton() {
  const closeBtn = document.getElementById('close-onboarding');
  if (!closeBtn) return;

  closeBtn.addEventListener('click', async () => {
    // Mark onboarding as completed so it doesn't show again
    try {
      await chrome.storage.local.set({ onboarding_completed: true });
    } catch {
      // Storage may fail in test environments — proceed anyway
    }

    // Close this tab
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id) {
        await chrome.tabs.remove(tab.id);
      }
    } catch {
      // If we can't close the tab, just navigate away
      window.close();
    }
  });
}

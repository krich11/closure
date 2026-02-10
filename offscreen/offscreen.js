/**
 * Closure — Offscreen Document (offscreen.js)
 * @version 1.3.2
 *
 * Runs in a DOM context where LanguageModel / window.ai is available.
 * The service worker sends prompts here via chrome.runtime.sendMessage
 * and receives AI responses back. No host permissions needed.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'aiPrompt') return false;

  handleAiPrompt(message.prompt)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      console.debug('[Closure:Offscreen] AI error:', err?.message || err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    });

  return true; // async sendResponse
});

/**
 * Send a prompt to the on-device AI and return the raw text response.
 *
 * @param {string} prompt
 * @returns {Promise<string>} raw AI response text
 */
async function handleAiPrompt(prompt) {
  let session;

  if (typeof LanguageModel !== 'undefined') {
    console.debug('[Closure:Offscreen] Using LanguageModel API');
    const availability = await LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    console.debug('[Closure:Offscreen] Availability:', availability);
    if (availability === 'unavailable') {
      throw new Error('AI unavailable');
    }
    session = await LanguageModel.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
  } else if (typeof window.ai !== 'undefined' && window.ai?.languageModel) {
    console.debug('[Closure:Offscreen] Using legacy window.ai API');
    const capabilities = await window.ai.languageModel.capabilities?.();
    if (capabilities?.available === 'no') {
      throw new Error('AI unavailable (legacy)');
    }
    session = await window.ai.languageModel.create();
  } else {
    throw new Error('No AI API available');
  }

  console.debug(`[Closure:Offscreen] Sending prompt (${prompt.length} chars)...`);
  const response = await session.prompt(prompt);
  session.destroy();
  console.debug('[Closure:Offscreen] Response:', response.substring(0, 200));

  return response;
}

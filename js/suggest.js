// Starter principles for sections of the constitution that are still empty
// (offered in the facilitator's Tidy step).

// The same rule, give or take capitals, spacing and a closing full stop.
const ruleKey = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?;:,]+$/, '');

// The section's own suggestion (workshop.json) first, then those of the cases
// aimed at it, in case order. A rule that has already been captured, in any
// section and even if it was dropped since, isn't offered again.
export function suggestionsFor(config, principles, categoryId) {
  const category = config.categories.find((c) => c.id === categoryId);
  const taken = new Set(principles.map((p) => ruleKey(p.text)));
  return [
    ...(category?.suggestedPrinciple ? [{ text: category.suggestedPrinciple, caseId: '' }] : []),
    ...config.cases
      .filter((c) => c.suggestedSection === categoryId && c.suggestedPrinciple)
      .map((c) => ({ text: c.suggestedPrinciple, caseId: c.id })),
  ].filter((s) => !taken.has(ruleKey(s.text)));
}

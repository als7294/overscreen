// SAMSUCKS wordmark in the style of Samsung's: heavy, wide caps whose A has no crossbar.
// The A is drawn as an SVG so it matches the font's cap height and stroke.
const A = '<svg class="logo-a" viewBox="0 0 100 100" aria-hidden="true"><path d="M0 100 L39 0 H61 L100 100 H79 L50 25 L21 100 Z"/></svg>';

export const LOGO_HTML = '<span class="logo" aria-label="SamSUCKS">S' + A + 'MSUCKS</span>';

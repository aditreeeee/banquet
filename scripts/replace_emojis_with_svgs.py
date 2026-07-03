import os
import re
from pathlib import Path

root = Path(r"c:/Users/inder/Claude/Projects/Banquet Booking application")
files = []
for path in root.rglob('*'):
    if path.is_file() and path.suffix.lower() in {'.html', '.js', '.css'} and not any(part.startswith('.') for part in path.parts):
        files.append(path)

svg_icon = lambda body: f'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;">{body}</svg>'

mapping = {
    '🏛': svg_icon('<path d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h6"></path>'),
    '📊': svg_icon('<path d="M4 19V10"></path><path d="M12 19V5"></path><path d="M20 19v-7"></path>'),
    '🏰': svg_icon('<path d="M4 20V9l8-5 8 5v11"></path><path d="M8 20v-5h8v5"></path><path d="M10 9h4"></path>'),
    '🚪': svg_icon('<path d="M5 20V9.5A1.5 1.5 0 0 1 6.5 8h11A1.5 1.5 0 0 1 19 9.5V20"></path><path d="M9 20v-4h6v4"></path><path d="M12 8v6"></path>'),
    '📅': svg_icon('<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 9h18"></path>'),
    '➕': svg_icon('<path d="M12 5v14"></path><path d="M5 12h14"></path>'),
    '👥': svg_icon('<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"></path><circle cx="9.5" cy="7" r="3"></circle><path d="M17 8a3 3 0 1 1 0 6"></path><path d="M20 19v-1a2 2 0 0 0-1.4-1.9"></path>'),
    '💰': svg_icon('<path d="M12 3v18"></path><path d="M16 7H8a3 3 0 1 0 0 6h8a3 3 0 1 1 0 6H8"></path>'),
    '🧾': svg_icon('<path d="M7 3h8l4 4v14H7z"></path><path d="M15 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path>'),
    '📈': svg_icon('<path d="M4 18 9 13l3 3 8-9"></path><path d="M18 7h3v3"></path>'),
    '📋': svg_icon('<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path>'),
    '⚙': svg_icon('<circle cx="12" cy="12" r="3"></circle><path d="M19 12a7 7 0 0 0-.1-1l2.1-1.6-2-3.5-2.5 1A7 7 0 0 0 15 4.4L14 2h-4l-1 2.4a7 7 0 0 0-1.5 1.5L5 5.9l-2 3.5 2.1 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1L3 14.6l2 3.5 2.5-1a7 7 0 0 0 1.5 1.5l1 2.4h4l1-2.4a7 7 0 0 0 1.5-1.5l2.5 1 2-3.5-2.1-1.6c.1-.3.1-.7.1-1z"></path>'),
    '⚙️': svg_icon('<circle cx="12" cy="12" r="3"></circle><path d="M19 12a7 7 0 0 0-.1-1l2.1-1.6-2-3.5-2.5 1A7 7 0 0 0 15 4.4L14 2h-4l-1 2.4a7 7 0 0 0-1.5 1.5L5 5.9l-2 3.5 2.1 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1L3 14.6l2 3.5 2.5-1a7 7 0 0 0 1.5 1.5l1 2.4h4l1-2.4a7 7 0 0 0 1.5-1.5l2.5 1 2-3.5-2.1-1.6c.1-.3.1-.7.1-1z"></path>'),
    '☰': svg_icon('<line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line>'),
    '🌙': svg_icon('<path d="M20 15.5A8.5 8.5 0 1 1 8.5 4a7 7 0 0 0 11.5 11.5Z"></path>'),
    '🔔': svg_icon('<path d="M12 4a4 4 0 0 0-4 4v2.4a5 5 0 0 1-.8 2.8L6 15h12l-1.2-1.8a5 5 0 0 1-.8-2.8V8a4 4 0 0 0-4-4Z"></path><path d="M10 18a2 2 0 0 0 4 0"></path>'),
    '⟳': svg_icon('<path d="M21 12a9 9 0 1 1-2.6-6.3"></path><path d="M21 3v6h-6"></path>'),
    '☀️': svg_icon('<circle cx="12" cy="12" r="4.5"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>'),
    '🔍': svg_icon('<circle cx="11" cy="11" r="6"></circle><path d="m20 20-4.2-4.2"></path>'),
    '💾': svg_icon('<path d="M6 3h9l4 4v14H6z"></path><path d="M14 3v5h4"></path><path d="M8 13h8"></path><path d="M8 17h8"></path>'),
    '✅': svg_icon('<path d="M20 6 9 17l-5-5"></path>'),
    '✏️': svg_icon('<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>'),
    '🔒': svg_icon('<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 1 1 8 0v3"></path>'),
    '🔓': svg_icon('<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 1 1 8 0"></path>'),
    '🔑': svg_icon('<circle cx="8" cy="15" r="3"></circle><path d="M11 12h8"></path><path d="M16 9l3 3"></path>'),
    '📄': svg_icon('<path d="M7 3h8l4 4v14H7z"></path><path d="M15 3v5h5"></path>'),
    '🖨️': svg_icon('<path d="M6 8V4h12v4"></path><path d="M6 12h12"></path><path d="M6 16h12"></path><path d="M6 20h12"></path>'),
    '📧': svg_icon('<path d="M4 6h16v12H4z"></path><path d="m4 7 8 6 8-6"></path>'),
    '🚫': svg_icon('<circle cx="12" cy="12" r="10"></circle><path d="m8 8 8 8"></path><path d="m16 8-8 8"></path>'),
    '📱': svg_icon('<rect x="5" y="2" width="14" height="20" rx="2"></rect><path d="M11 18h2"></path>'),
    '🏦': svg_icon('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path>'),
    '💳': svg_icon('<rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M2 10h20"></path>'),
    '💵': svg_icon('<path d="M12 3v18"></path><path d="M16 7H8a3 3 0 1 0 0 6h8a3 3 0 1 1 0 6H8"></path>'),
    '🌐': svg_icon('<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15 15 0 0 1 0 20"></path><path d="M12 2a15 15 0 0 0 0 20"></path>'),
    '🎉': svg_icon('<path d="M12 2v3"></path><path d="m7 5 2 2"></path><path d="m17 5-2 2"></path><path d="M5 12h14"></path><path d="M8 16h8"></path><path d="M10 20h4"></path>'),
    '🎨': svg_icon('<path d="M12 3a9 9 0 0 0 0 18"></path><path d="M12 3a9 9 0 0 1 0 18"></path><path d="M3 12h18"></path>'),
    '🏢': svg_icon('<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 20v-6h8v6"></path><path d="M8 10h8"></path>'),
    '💻': svg_icon('<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 19h8"></path><path d="M9 15h6"></path>'),
    '☀️': svg_icon('<circle cx="12" cy="12" r="4.5"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>'),
    '🍽': svg_icon('<path d="M6 3v8"></path><path d="M6 11h4"></path><path d="M10 3v8"></path><path d="M14 5h4"></path><path d="M16 3v10"></path>'),
    '🌿': svg_icon('<path d="M5 20c2-8 8-12 14-12"></path><path d="M5 20c4-2 7-5 8-10"></path>'),
    '🍗': svg_icon('<path d="M8 4c2 2 4 4 4 8"></path><path d="M4 8c4 0 7 2 9 6"></path>'),
    '🥩': svg_icon('<path d="M7 3c0 4 2 6 5 6"></path><path d="M7 9c4 0 8 2 8 8"></path>'),
    '🥗': svg_icon('<path d="M4 12h16"></path><path d="M8 12c0-4 3-7 4-7s4 3 4 7"></path>'),
    '🌸': svg_icon('<path d="M12 3c-2 2-2 4-2 7"></path><path d="M12 3c2 2 2 4 2 7"></path><path d="M8 10c2 1 3 2 4 5"></path><path d="M16 10c-2 1-3 2-4 5"></path>'),
    '🎤': svg_icon('<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"></path><path d="M8 13a4 4 0 0 0 8 0"></path><path d="M12 17v4"></path>'),
    '❄️': svg_icon('<path d="M12 3v18"></path><path d="M4 8l2 2"></path><path d="M18 8l-2 2"></path><path d="M4 16l2-2"></path><path d="M18 16l-2-2"></path><path d="M7 7l1.5 1.5"></path><path d="M15.5 15.5 17 17"></path>'),
    '👁': svg_icon('<path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>'),
    '✕': svg_icon('<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'),
    '✓': svg_icon('<path d="M20 6 9 17l-5-5"></path>'),
    '⚠': svg_icon('<path d="M12 3 2 20h20Z"></path><path d="M12 9v4"></path><path d="M12 16h.01"></path>'),
    '👤': svg_icon('<circle cx="12" cy="8" r="4"></circle><path d="M4 20a8 8 0 0 1 16 0"></path>'),
    '📲': svg_icon('<rect x="5" y="2" width="14" height="20" rx="2"></rect><path d="M11 18h2"></path>'),
    '⚽': svg_icon('<circle cx="12" cy="12" r="8"></circle><path d="M4 4l4 4"></path><path d="M16 16l4 4"></path>'),
    '🧡': svg_icon('<path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.3A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z"></path>'),
}

pattern = re.compile(r'[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]')

changed = []
for path in files:
    try:
        text = path.read_text(encoding='utf-8', errors='ignore')
    except Exception:
        continue

    def repl(match):
        ch = match.group(0)
        if ch in {'\uFE0F', '\u200D'}:
            return ''
        return mapping.get(ch, svg_icon('<circle cx="12" cy="12" r="8"></circle>'))

    new_text = pattern.sub(repl, text)
    if new_text != text:
        path.write_text(new_text, encoding='utf-8')
        changed.append(str(path))

print(f'Updated {len(changed)} files')
for item in changed[:50]:
    print(item)

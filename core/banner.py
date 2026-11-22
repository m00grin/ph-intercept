"""The startup banner and the per-player lines under it, drawn in text.

The ship is the game's own sprite (static/js/splash.js) and the colors are the
brand's (white ship, the site's blue on the wordmark). Color is used only when
the output is a terminal; a container's log is plain, the art is the same.
"""
from .version import VERSION

SHIP = [
    "000000000010000000000", "000000000111000000000", "000000000111000000000", "000000000111000000000",
    "000000001111100000000", "000000111111111000000", "000011111111111110000", "000111001111100111000",
    "001110001111100011100", "011100001111100001110", "111000000111000000111", "111000000010000000111",
    "111000000000000000111", "011100000000000001110", "001111000000000111100", "001111000000000111100",
    "000110000000000011000",
]

_FONT = {
    "P": ["111", "101", "111", "100", "100"], "H": ["101", "101", "111", "101", "101"],
    "-": ["000", "000", "111", "000", "000"], "I": ["111", "010", "010", "010", "111"],
    "N": ["111", "101", "101", "101", "101"], "T": ["111", "010", "010", "010", "010"],
    "E": ["111", "100", "110", "100", "111"], "R": ["110", "101", "110", "101", "101"],
    "C": ["111", "100", "100", "100", "111"],
}
WORD = "PH-INTERCEPT"
TAG = "I N T E R C E P T   P R O G R A M"

_WHITE = (255, 255, 255)
_WORD_ROWS = [(228, 238, 255), (214, 236, 255), (159, 208, 255), (95, 180, 255), (74, 157, 255)]
_TAG = (200, 218, 242)
_LABEL = (228, 238, 255)
_NAME = (95, 180, 255)
_MUTED = (138, 155, 184)
_GOOD = (126, 224, 160)
_WARN = (255, 190, 92)
_RESET = "\033[0m"


def _fg(rgb):
    return "\033[38;2;%d;%d;%dm" % rgb


def _bg(rgb):
    return "\033[48;2;%d;%d;%dm" % rgb


def _paint(text: str, rgb, color: bool, bold: bool = False) -> str:
    if not color or not text:
        return text
    return ("\033[1m" if bold else "") + _fg(rgb) + text + _RESET


def _blocks(rows: list[str], colors: list, color: bool) -> list[str]:
    """Two pixel rows per text row, so pixels stay square. In color, the top and
    bottom pixel of a cell can differ, which is how the wordmark gets its gradient."""
    rows = rows + ["0" * len(rows[0])] * (len(rows) % 2)
    colors = colors + colors[-1:] * (len(colors) % 2)
    out = []
    for r in range(0, len(rows), 2):
        top, bottom, ct, cb = rows[r], rows[r + 1], colors[r], colors[r + 1]
        cells = []
        for t, b in zip(top, bottom):
            t, b = t == "1", b == "1"
            if not color:
                cells.append("█" if t and b else "▀" if t else "▄" if b else " ")
            elif t and b:
                cells.append(_fg(ct) + "█" + _RESET if ct == cb else _fg(ct) + _bg(cb) + "▀" + _RESET)
            elif t:
                cells.append(_fg(ct) + "▀" + _RESET)
            elif b:
                cells.append(_fg(cb) + "▄" + _RESET)
            else:
                cells.append(" ")
        while cells and cells[-1] == " ":
            cells.pop()
        out.append("".join(cells))
    return out


def _wordmark_rows() -> list[str]:
    return ["0".join(_FONT[ch][r] for ch in WORD) for r in range(5)]


def lines(color: bool) -> list[str]:
    """The banner, one log line per entry."""
    word_rows = _wordmark_rows()
    width = len(word_rows[0])
    ship_pad = " " * ((width - len(SHIP[0])) // 2)
    ship = [ship_pad + row for row in _blocks(SHIP, [_WHITE] * len(SHIP), color)]
    word = _blocks(word_rows, _WORD_ROWS, color)
    tag = " " * ((width - len(TAG)) // 2) + _paint(TAG, _TAG, color)
    version = "  " + _paint("version", _MUTED, color) + "  " + _paint(VERSION, _LABEL, color, bold=True)
    return ["", *ship, "", *word, tag, "", version]


_NAME_WIDTH = 13   # "AdGuard Home" plus a space


def side(slot: int, name: str, url: str = "", status: str = "", color: bool = False) -> str:
    """'  P1  AdGuard Home  http://h:3000/control  ● detected'"""
    label = _paint(f"P{slot}", _LABEL, color, bold=True)
    if not url:
        return f"  {label}  {_paint(name, _MUTED, color)}"
    line = f"  {label}  {_paint(name.ljust(_NAME_WIDTH), _NAME, color)} {url}"
    if status:
        line += "   " + _paint("● " + status, _GOOD, color)
    return line


def detail(text: str, color: bool = False) -> str:
    """A line under a player's line, indented to its name."""
    return "      " + _paint(text, _MUTED, color)


def problem(slot: int, text: str, color: bool = False) -> str:
    """A player that can't start, or is waiting: '  P1  not started: ...'"""
    return f"  {_paint(f'P{slot}', _LABEL, color, bold=True)}  {_paint(text, _WARN, color)}"


def elapsed(seconds: float) -> str:
    """'14 s', '1 min 30 s', '12 min'"""
    seconds = int(round(seconds))
    if seconds < 60:
        return f"{seconds} s"
    minutes, rest = divmod(seconds, 60)
    return f"{minutes} min {rest} s" if rest and minutes < 10 else f"{minutes} min"

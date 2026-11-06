"""A short, human name for a signed-in device, for the "signed-in devices" list.

Only the label is stored, never the user agent itself (data minimisation): enough for a student
to tell "Chrome on Windows" from "Lumiback app on Android", not enough to fingerprint them.
"""

BROWSERS = (  # order matters: Edge and Opera also say "Chrome", Chrome also says "Safari"
    ("Edg/", "Edge"),
    ("EdgA/", "Edge"),
    ("OPR/", "Opera"),
    ("SamsungBrowser/", "Samsung Internet"),
    ("Firefox/", "Firefox"),
    ("FxiOS/", "Firefox"),
    ("CriOS/", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)
SYSTEMS = (  # order matters: Android also says "Linux", iPhone also says "Mac OS X"
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("CrOS", "ChromeOS"),
    ("Windows", "Windows"),
    ("Macintosh", "Mac"),
    ("Linux", "Linux"),
)


def _first(ua: str, table: tuple[tuple[str, str], ...]) -> str | None:
    return next((name for needle, name in table if needle in ua), None)


def label(device: str | None, user_agent: str | None) -> str | None:
    """The app's own name for itself if it sent one, else a summary of the user agent."""
    if device:
        return device[:80]
    ua = (user_agent or "")[:512]
    system = _first(ua, SYSTEMS)
    if "okhttp" in ua or "Expo" in ua:  # the Android app, before it named itself
        return f"Lumiback app on {system or 'Android'}"
    if not ua.startswith("Mozilla/"):
        return None  # a script, a server or something unknown: no guess
    browser = _first(ua, BROWSERS)
    if browser and system:
        return f"{browser} on {system}"
    return browser or (f"Browser on {system}" if system else None)

import logging
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
log = logging.getLogger("nexora.config")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "nexora")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
# POST/PUT/DELETE requests one address may send per minute (server.py). Leave it at 120 on the server; CI raises it,
# because the whole API test suite runs from a single address in a few seconds.
WRITE_LIMIT_PER_MIN = int(os.environ.get("WRITE_LIMIT_PER_MIN", "120"))

MEDIA_SIGNING_SECRET = os.environ.get("MEDIA_SIGNING_SECRET", "")
if not MEDIA_SIGNING_SECRET:
    # Dev fallback only: signed media URLs become invalid after every restart.
    MEDIA_SIGNING_SECRET = secrets.token_hex(32)
    log.warning("MEDIA_SIGNING_SECRET is not set; using a random per-process secret (set it in production)")

ROOM_LIFETIME_S = int(os.environ.get("ROOM_LIFETIME_HOURS", "24")) * 3600
ROOM_PURGE_GRACE_S = int(os.environ.get("ROOM_PURGE_GRACE_HOURS", "24")) * 3600
# When the host has been disconnected this long, the longest-present online participant becomes the host. Two minutes:
# a host who switches to another app for a moment (to copy a link) comes back still owning the room.
HOST_HANDOVER_S = float(os.environ.get("HOST_HANDOVER_SECONDS", "120"))

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(2 * 1024**3)))
STORAGE_QUOTA_BYTES = int(os.environ.get("STORAGE_QUOTA_BYTES", str(18 * 1024**3)))
PARTICIPANT_QUOTA_BYTES = int(os.environ.get("PARTICIPANT_QUOTA_BYTES", str(4 * 1024**3)))
STORAGE_WARN_RATIO = float(os.environ.get("STORAGE_WARN_RATIO", "0.8"))
OCI_MONTHLY_REQUEST_LIMIT = int(os.environ.get("OCI_MONTHLY_REQUEST_LIMIT", "45000"))
MEDIA_RETENTION_DAYS = int(os.environ.get("MEDIA_RETENTION_DAYS", "7"))
STALE_UPLOAD_HOURS = int(os.environ.get("STALE_UPLOAD_HOURS", "24"))

# Local disk storage (default). In Docker this is a mounted volume.
MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", str(Path(__file__).parent / "data" / "media"))).resolve()

OCI_S3_ENDPOINT = os.environ.get("OCI_S3_ENDPOINT", "")
OCI_REGION = os.environ.get("OCI_REGION", "")
OCI_ACCESS_KEY = os.environ.get("OCI_ACCESS_KEY", "")
OCI_SECRET_KEY = os.environ.get("OCI_SECRET_KEY", "")
OCI_BUCKET = os.environ.get("OCI_BUCKET", "")

STORAGE_DRIVER = "oci" if all([OCI_S3_ENDPOINT, OCI_REGION, OCI_ACCESS_KEY, OCI_SECRET_KEY, OCI_BUCKET]) else "local"

MEDIA_DELETE_AFTER_CLOSE_HOURS = float(os.environ.get("MEDIA_DELETE_AFTER_CLOSE_HOURS", "1"))

# --- Public app config / content policy -------------------------------------------------------------------
WEB_URL = os.environ.get("WEB_URL", "https://nexora.lenstedreal.info").rstrip("/")
PLAY_URL = os.environ.get("PLAY_URL", "")
APK_URL = os.environ.get("APK_URL", "https://github.com/LenstedReal/NexoraWatch/releases/latest")
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", "contact.nexorawatch@protonmail.com")
# Minimum age asked at first start (under 18: with a parent/guardian). Keep in sync with the Play Console target audience.
MIN_AGE = int(os.environ.get("MIN_AGE", "16"))
# KVKK data controller shown on the legal pages (set OWNER_NAME to your full legal name in .env).
OWNER_NAME = os.environ.get("OWNER_NAME", "").strip()
OWNER_ADDRESS = os.environ.get("OWNER_ADDRESS", "").strip()

# Sites offered in the app's browser and on the web (the same list on both). The room keeps every one of them together:
#   official players, synced:  YouTube, TikTok, Facebook, Twitch (past broadcasts synced; live channels: everyone live,
#                              the room follows play / pause)
#   Nexora's player, synced:   X (the post's video file), Kick (live channels, recordings, clips) and Reddit (the post's
#                              HLS): the server finds the file a pasted link leads to (resolver._x / _kick / _reddit);
#                              Kick and Reddit may refuse servers, then the app's browser finds it in the page itself
#                              (docs/BEKLEYENLER.md)
#   not listed:                Instagram (its player has no control, its files open only on instagram.com),
#                              Dailymotion (waits for its official player: docs/BEKLEYENLER.md), DRM/subscription services
# Drive files are added by their share link. Override with ALLOWED_SITES in .env ("domain|Name,...").
_DEFAULT_SITES = ("youtube.com|YouTube,tiktok.com|TikTok,x.com|X,facebook.com|Facebook,twitch.tv|Twitch,kick.com|Kick,"
                  "reddit.com|Reddit,drive.google.com|Google Drive")
# Reddit: no API key can be had any more (Reddit stopped taking new Data API requests on 31 Oct 2026), so the server
# reads a post's public data without one; see docs/BEKLEYENLER.md.
# Accepted as source pages too, but not listed: old X addresses, and sites whose links still play (in sync) when pasted.
QUIET_SITES = [h.strip().lower().lstrip(".") for h in (os.environ.get("QUIET_SITES") or "twitter.com,vimeo.com,archive.org").split(",") if h.strip()]
ALLOWED_SITES: list[dict] = []
for _item in (os.environ.get("ALLOWED_SITES") or _DEFAULT_SITES).split(","):
    _dom, _, _name = _item.strip().partition("|")
    _dom = _dom.strip().lower().lstrip(".")
    if _dom:
        ALLOWED_SITES.append({"domain": _dom, "name": (_name.strip() or _dom)})

_DEFAULT_BLOCKED = ("netflix.com,disneyplus.com,primevideo.com,amazon.com,max.com,hbomax.com,blutv.com,exxen.com,"
                    "gain.com.tr,tabii.com,puhutv.com,mubi.com,tv.apple.com,spotify.com")
# Rave-style subscription services watched inside the mobile app with each person's own account (services.py, beta).
# Off since 1.8.3: Nexora offers no DRM / subscription platform (their links are blocked like the hosts above).
# SERVICES_ENABLED=1 would turn the beta back on.
SERVICES_ENABLED = os.environ.get("SERVICES_ENABLED", "0").strip().lower() not in ("0", "false", "no", "off")
BLOCKED_HOSTS = [h.strip().lower().lstrip(".") for h in (os.environ.get("BLOCKED_HOSTS") or _DEFAULT_BLOCKED).split(",") if h.strip()]

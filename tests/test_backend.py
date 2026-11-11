#!/usr/bin/env python3
"""Backend (os/backend/beeos_server.py) için birim testleri.

Ağ ve subprocess bağımlı fonksiyonlar test edilmez; saf yardımcı fonksiyonlar
(ver_tuple, tv_url_ok, _clean_text, session_check, sleep_set) hedeflenir.
"""
import os
import sys
import tempfile
import time
import unittest

# beeos_server.py Linux-specific (fcntl, /dev/uinput). Windows'ta geliştirme sırasında
# tüm testler atlanır; CI (Ubuntu) üzerinde normal çalışır.
TMP = tempfile.mkdtemp(prefix="beeos-test-")
os.environ["BEEOS_WEB"] = TMP
os.makedirs(os.path.join(TMP, "web"), exist_ok=True)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "os", "backend"))

bs = None
IMPORT_ERR = None
try:
    import beeos_server as bs  # noqa: E402
except ImportError as e:
    IMPORT_ERR = str(e)


def _skip_if_no_bs(cls):
    if bs is None:
        cls = unittest.skip("beeos_server import edilemedi: %s" % IMPORT_ERR)(cls)
    return cls


@_skip_if_no_bs
@_skip_if_no_bs
class VerTuple(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(bs.ver_tuple("1.2.3"), (1, 2, 3))

    def test_v_prefix(self):
        self.assertEqual(bs.ver_tuple("v0.8.0"), (0, 8, 0))

    def test_invalid(self):
        self.assertEqual(bs.ver_tuple("abc"), ())
        self.assertEqual(bs.ver_tuple(""), ())

    def test_compare(self):
        self.assertTrue(bs.ver_tuple("0.8.0") > bs.ver_tuple("0.7.9"))
        self.assertTrue(bs.ver_tuple("1.0.0") > bs.ver_tuple("0.9.99"))


@_skip_if_no_bs
@_skip_if_no_bs
class TvUrlOk(unittest.TestCase):
    def test_public_https(self):
        # example.com DNS'e bağlı — ağ yoksa bu test atlanır
        try:
            import socket
            socket.getaddrinfo("example.com", None)
        except OSError:
            self.skipTest("DNS yok")
        self.assertTrue(bs.tv_url_ok("http://example.com"))

    def test_loopback(self):
        self.assertFalse(bs.tv_url_ok("http://127.0.0.1"))
        self.assertFalse(bs.tv_url_ok("http://localhost"))

    def test_link_local(self):
        self.assertFalse(bs.tv_url_ok("http://169.254.1.1"))

    def test_private_ranges_blocked(self):
        # allowLan kapalı (varsayılan) → private aralıklar reddedilsin
        self.assertFalse(bs.tv_url_ok("http://192.168.1.1"))
        self.assertFalse(bs.tv_url_ok("http://10.0.0.1"))
        self.assertFalse(bs.tv_url_ok("http://172.16.0.1"))

    def test_bad_scheme(self):
        self.assertFalse(bs.tv_url_ok("file:///etc/passwd"))
        self.assertFalse(bs.tv_url_ok("ftp://example.com"))
        self.assertFalse(bs.tv_url_ok(""))

    def test_no_host(self):
        self.assertFalse(bs.tv_url_ok("http://"))


@_skip_if_no_bs
@_skip_if_no_bs
class CleanText(unittest.TestCase):
    def test_strips_rtl_override(self):
        # U+202E: Right-to-Left Override (Cf)
        s = "merhaba‮ dunya"
        out = bs._clean_text(s)
        self.assertNotIn("‮", out)
        self.assertIn("merhaba", out)
        self.assertIn("dunya", out)

    def test_keeps_space(self):
        self.assertEqual(bs._clean_text("a b c"), "a b c")

    def test_200_char_limit(self):
        s = "x" * 500
        self.assertEqual(len(bs._clean_text(s)), 200)

    def test_strips_control_chars(self):
        self.assertNotIn("\x00", bs._clean_text("a\x00b"))
        self.assertNotIn("\x07", bs._clean_text("a\x07b"))

    def test_turkish_chars(self):
        # Türkçe karakterler korunmalı
        self.assertEqual(bs._clean_text("ışığıöçş"), "ışığıöçş")


@_skip_if_no_bs
@_skip_if_no_bs
class SessionCheck(unittest.TestCase):
    def test_bad_sid_format(self):
        headers = {"X-BeeOS-Session": "not-hex", "X-BeeOS-Sig": "a" * 64,
                   "X-BeeOS-Nonce": "abcdefgh"}
        self.assertIsNone(bs.session_check(headers, "POST", "/api/key", b""))

    def test_bad_sig_format(self):
        headers = {"X-BeeOS-Session": "a" * 32, "X-BeeOS-Sig": "zz",
                   "X-BeeOS-Nonce": "abcdefgh"}
        self.assertIsNone(bs.session_check(headers, "POST", "/api/key", b""))

    def test_bad_nonce_format(self):
        headers = {"X-BeeOS-Session": "a" * 32, "X-BeeOS-Sig": "f" * 64,
                   "X-BeeOS-Nonce": "ab"}  # too short
        self.assertIsNone(bs.session_check(headers, "POST", "/api/key", b""))

    def test_unknown_session(self):
        headers = {"X-BeeOS-Session": "a" * 32, "X-BeeOS-Sig": "f" * 64,
                   "X-BeeOS-Nonce": "abcdefgh"}
        self.assertIsNone(bs.session_check(headers, "POST", "/api/key", b""))

    def test_missing_headers(self):
        self.assertIsNone(bs.session_check({}, "POST", "/api/key", b""))


@_skip_if_no_bs
@_skip_if_no_bs
class SleepTimer(unittest.TestCase):
    def test_cancel(self):
        bs.sleep_set(0)
        r = bs.sleep_get()
        self.assertEqual(r["left"], 0)
        self.assertEqual(r["action"], "")

    def test_set(self):
        bs.sleep_set(30, "off")
        r = bs.sleep_get()
        self.assertGreater(r["left"], 29 * 60)
        self.assertLessEqual(r["left"], 30 * 60)
        self.assertEqual(r["action"], "off")
        bs.sleep_set(0)  # cleanup

    def test_closeapps(self):
        bs.sleep_set(5, "closeapps")
        self.assertEqual(bs.sleep_get()["action"], "closeapps")
        bs.sleep_set(0)

    def test_clamp(self):
        bs.sleep_set(99999)
        self.assertLessEqual(bs.sleep_get()["left"], 600 * 60 + 5)
        bs.sleep_set(0)


@_skip_if_no_bs
@_skip_if_no_bs
class MirrorState(unittest.TestCase):
    def test_idle_initially(self):
        bs.mirror_reset()
        p = bs.mirror_pending()
        self.assertIsNone(p["pending"])
        self.assertEqual(p["state"], "idle")

    def test_reject_signal_when_idle(self):
        bs.mirror_reset()
        r = bs.mirror_signal({"role": "offerer"}, {"X-BeeOS-Mirror": "whatever"})
        self.assertFalse(r.get("ok"))

    def test_start_sets_pending(self):
        bs.mirror_reset()
        r = bs.mirror_start({"sdp": "v=0..."}, device="Test Phone")
        self.assertTrue(r.get("ok"))
        self.assertTrue(r.get("pending"))
        self.assertTrue(r.get("token"))
        p = bs.mirror_pending()
        self.assertEqual(p["pending"]["device"], "Test Phone")
        self.assertEqual(p["state"], "pending")
        bs.mirror_reset()

    def test_reject_approval(self):
        bs.mirror_reset()
        bs.mirror_start({"sdp": "v=0..."}, device="Dev")
        r = bs.mirror_approve(False)
        self.assertTrue(r.get("ok"))
        self.assertEqual(bs.mirror_pending()["state"], "idle")


@_skip_if_no_bs
class MirrorToken(unittest.TestCase):
    """0.9: answerer token zorunlu (Y1 düzeltmesi)."""
    def test_answerer_requires_token(self):
        bs.mirror_reset()
        bs.mirror_start({"sdp": "v=0..."}, device="Dev")
        bs.mirror_approve(True)
        # Token'sız answerer çağrısı reddedilsin
        r = bs.mirror_signal({"role": "answerer", "sdp": "v=0..."}, headers={"X-BeeOS": "1"})
        self.assertFalse(r.get("ok"))
        self.assertEqual(r.get("error"), "forbidden")
        bs.mirror_reset()

    def test_answerer_with_token_ok(self):
        bs.mirror_reset()
        bs.mirror_start({"sdp": "v=0..."}, device="Dev")
        bs.mirror_approve(True)
        # Doğru answerer_token ile kabul edilsin
        token = bs.mirror["answerer_token"]
        self.assertTrue(token)
        r = bs.mirror_signal({"role": "answerer", "sdp": "v=0..."},
                             headers={"X-BeeOS": "1", "X-BeeOS-Mirror": token})
        self.assertTrue(r.get("ok"))
        bs.mirror_reset()

    def test_concurrent_start_rejected(self):
        """O5: ikinci cihaz araya giremez."""
        bs.mirror_reset()
        bs.mirror_start({"sdp": "v=0..."}, device="İlk")
        r2 = bs.mirror_start({"sdp": "v=0..."}, device="İkinci")
        self.assertFalse(r2.get("ok"))
        self.assertIn("Başka", r2.get("error", ""))
        bs.mirror_reset()


@_skip_if_no_bs
class IPBan(unittest.TestCase):
    """0.10: IP başına başarısız PIN sayacı."""
    def test_no_ban_initially(self):
        self.assertEqual(bs._ip_check("1.2.3.4"), 0)

    def test_ban_after_5_fails(self):
        ip = "9.9.9.9"
        bs.ip_fails.pop(ip, None)
        for _ in range(5):
            bs._ip_record_fail(ip)
        self.assertGreater(bs._ip_check(ip), 60)
        bs._ip_record_ok(ip)   # cleanup

    def test_ok_clears(self):
        ip = "8.8.8.8"
        bs._ip_record_fail(ip)
        bs._ip_record_ok(ip)
        self.assertEqual(bs._ip_check(ip), 0)


@_skip_if_no_bs
class Notifications(unittest.TestCase):
    """0.10: bildirim merkezi."""
    def test_notify_adds(self):
        bs.notification_clear()
        n = bs.notify("Test", "body", "info")
        self.assertIn("id", n)
        r = bs.notification_list()
        self.assertEqual(len(r["items"]), 1)
        self.assertEqual(r["unread"], 1)

    def test_mark_seen(self):
        bs.notification_clear()
        bs.notify("x")
        r = bs.notification_list(mark_seen=True)
        self.assertEqual(r["unread"], 1)   # read sırasında unread hesabı seen=False iken
        r2 = bs.notification_list()
        self.assertEqual(r2["unread"], 0)

    def test_clear_one(self):
        bs.notification_clear()
        n = bs.notify("a")
        bs.notify("b")
        bs.notification_clear(item_id=n["id"])
        self.assertEqual(len(bs.notification_list()["items"]), 1)

    def test_max_cap(self):
        bs.notification_clear()
        for i in range(bs.NOTIF_MAX + 10):
            bs.notify("n%d" % i)
        self.assertEqual(len(bs.notification_list()["items"]), bs.NOTIF_MAX)


@_skip_if_no_bs
class Backup(unittest.TestCase):
    def test_export_structure(self):
        r = bs.backup_export()
        self.assertTrue(r.get("ok"))
        self.assertIn("backup", r)
        self.assertIn("version", r["backup"])
        self.assertIn("data", r["backup"])

    def test_import_invalid(self):
        self.assertFalse(bs.backup_import(None).get("ok"))
        self.assertFalse(bs.backup_import("string").get("ok"))
        self.assertFalse(bs.backup_import({"no-data": True}).get("ok"))


@_skip_if_no_bs
class SwapDir(unittest.TestCase):
    """0.12: swap_dir atomikliği — new dest'e geçer, eski dest .prev olur."""
    import shutil as _sh

    def _mkdir(self, name, content="hello"):
        d = tempfile.mkdtemp(prefix="beeos-swap-")
        self.addCleanup(SwapDir._sh.rmtree, d, True)
        with open(os.path.join(d, "f.txt"), "w", encoding="utf-8") as f:
            f.write(content)
        return d

    def test_swap_moves_new_to_dest(self):
        new = self._mkdir("new", "v2")
        dest_parent = tempfile.mkdtemp(prefix="beeos-swap-")
        self.addCleanup(SwapDir._sh.rmtree, dest_parent, True)
        dest = os.path.join(dest_parent, "web")
        SwapDir._sh.copytree(self._mkdir("old", "v1"), dest)
        bs.swap_dir(new, dest)
        self.assertFalse(os.path.exists(new))
        with open(os.path.join(dest, "f.txt"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "v2")
        with open(os.path.join(dest + ".prev", "f.txt"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "v1")

    def test_swap_without_existing_dest(self):
        new = self._mkdir("new", "v2")
        dest_parent = tempfile.mkdtemp(prefix="beeos-swap-")
        self.addCleanup(SwapDir._sh.rmtree, dest_parent, True)
        dest = os.path.join(dest_parent, "web")
        bs.swap_dir(new, dest)
        self.assertTrue(os.path.isdir(dest))
        self.assertFalse(os.path.exists(dest + ".prev"))

    def test_swap_missing_new_raises(self):
        dest_parent = tempfile.mkdtemp(prefix="beeos-swap-")
        self.addCleanup(SwapDir._sh.rmtree, dest_parent, True)
        dest = os.path.join(dest_parent, "web")
        os.makedirs(dest)
        with self.assertRaises((FileNotFoundError, OSError)):
            bs.swap_dir(os.path.join(dest_parent, "nonexistent"), dest)
        # swap_dir, hata olursa eski dest'i prev'den geri getirmeli
        self.assertTrue(os.path.isdir(dest))

    def test_two_successive_swaps(self):
        dest_parent = tempfile.mkdtemp(prefix="beeos-swap-")
        self.addCleanup(SwapDir._sh.rmtree, dest_parent, True)
        dest = os.path.join(dest_parent, "web")
        SwapDir._sh.copytree(self._mkdir("v1", "v1"), dest)
        bs.swap_dir(self._mkdir("v2", "v2"), dest)      # dest=v2, .prev=v1
        bs.swap_dir(self._mkdir("v3", "v3"), dest)      # dest=v3, .prev=v2 (v1 silinmiş)
        with open(os.path.join(dest, "f.txt"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "v3")
        with open(os.path.join(dest + ".prev", "f.txt"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "v2")


@_skip_if_no_bs
class VerifySignature(unittest.TestCase):
    """0.12: minisign imza akışı — hata yolları."""
    def setUp(self):
        self._orig_pub = bs.UPDATE_PUB

    def tearDown(self):
        bs.UPDATE_PUB = self._orig_pub

    def test_no_key_passes_silently(self):
        # Anahtar yoksa fonksiyon return eder (uyar, hata atmaz)
        bs.UPDATE_PUB = "/tmp/beeos-no-such-key.pub"
        r = {"version": "0.1.0", "assets": {}}
        # None döner ve exception atmaz
        self.assertIsNone(bs.verify_signature(r, "/tmp/any"))

    def test_missing_minisign_binary(self):
        import shutil as _shutil
        if _shutil.which("minisign") is not None:
            self.skipTest("minisign yüklü — bu test minisign yokken anlamlı")
        # Anahtar var göster
        pub = tempfile.NamedTemporaryFile(mode="w", suffix=".pub", delete=False)
        pub.write("dummy"); pub.close()
        self.addCleanup(os.unlink, pub.name)
        bs.UPDATE_PUB = pub.name
        r = {"version": "0.1.0", "assets": {"beeos-update-0.1.0.tar.gz.minisig": {"url": "x"}}}
        with self.assertRaises(bs.UpdateError) as cm:
            bs.verify_signature(r, "/tmp/pkg")
        self.assertIn("doğrulayıcı", str(cm.exception))

    def test_missing_signature_asset(self):
        import shutil as _shutil
        if _shutil.which("minisign") is None:
            self.skipTest("minisign yok — bu test anahtar + minisign gerektirir")
        pub = tempfile.NamedTemporaryFile(mode="w", suffix=".pub", delete=False)
        pub.write("dummy"); pub.close()
        self.addCleanup(os.unlink, pub.name)
        bs.UPDATE_PUB = pub.name
        r = {"version": "0.1.0", "assets": {}}       # .minisig yok
        with self.assertRaises(bs.UpdateError) as cm:
            bs.verify_signature(r, "/tmp/pkg")
        self.assertIn("imzalı değil", str(cm.exception).lower().replace("i̇", "i"))


@_skip_if_no_bs
class AllowLan(unittest.TestCase):
    """0.12: _allow_lan tek kaynak (remote.json); backward compat için UPDATE_CONF okur."""
    def setUp(self):
        self._orig_conf = bs.UPDATE_CONF

    def tearDown(self):
        bs.UPDATE_CONF = self._orig_conf

    def test_default_false(self):
        # /etc/beeos yoksa + UPDATE_CONF yoksa False
        bs.UPDATE_CONF = "/tmp/beeos-nonexistent-update.json"
        # remote.json yoksa (Windows'ta zaten yok) False
        self.assertFalse(bs._allow_lan())

    def test_update_conf_backward_compat(self):
        # UPDATE_CONF içinde allowLan:true → True (uyarı loglar)
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
        import json as _json
        _json.dump({"allowLan": True}, f)
        f.close()
        self.addCleanup(os.unlink, f.name)
        bs.UPDATE_CONF = f.name
        # remote.json okunamıyor (hardcoded /etc/beeos path yok), UPDATE_CONF'ten okumalı
        if os.path.exists("/etc/beeos/remote.json"):
            self.skipTest("/etc/beeos/remote.json var; hardcoded path üzerinden test anlamsız")
        self.assertTrue(bs._allow_lan())

    def test_update_conf_false_value(self):
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
        import json as _json
        _json.dump({"allowLan": False}, f)
        f.close()
        self.addCleanup(os.unlink, f.name)
        bs.UPDATE_CONF = f.name
        if os.path.exists("/etc/beeos/remote.json"):
            self.skipTest("/etc/beeos/remote.json var; hardcoded path üzerinden test anlamsız")
        self.assertFalse(bs._allow_lan())

    def test_invalid_json(self):
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
        f.write("{not json"); f.close()
        self.addCleanup(os.unlink, f.name)
        bs.UPDATE_CONF = f.name
        if os.path.exists("/etc/beeos/remote.json"):
            self.skipTest("/etc/beeos/remote.json var")
        self.assertFalse(bs._allow_lan())


if __name__ == "__main__":
    unittest.main(verbosity=2)

// Arayüz ses efektleri. Ses dosyası yok: Web Audio ile kısa tonlar üretilir (yükleme maliyeti sıfır).
var Sound = (function () {
  var ctx = null, enabled = true, volume = 0.5;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return null; }
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended" && ctx.resume) { ctx.resume(); }
    return ctx;
  }

  // freq: başlangıç frekansı, dur: süre (sn), slideTo: bitiş frekansı (kayma efekti)
  function tone(freq, dur, type, gain, delay, slideTo) {
    var c = ensure();
    if (!c) { return; }
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) { o.frequency.exponentialRampToValueAtTime(slideTo, t + dur); }
    var v = Math.max((gain || 0.2) * volume, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Arı vızıltısı: testere dalgası + hızlı titreşim (LFO) + kısık alçak geçiren filtre
  function buzz(delay, dur) {
    var c = ensure();
    if (!c) { return; }
    var t = c.currentTime + delay;
    var o = c.createOscillator(), lfo = c.createOscillator();
    var lfoGain = c.createGain(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(210, t);
    o.frequency.linearRampToValueAtTime(260, t + dur);
    lfo.frequency.setValueAtTime(28, t);
    lfoGain.gain.setValueAtTime(18, t);
    f.type = "lowpass";
    f.frequency.setValueAtTime(1400, t);
    var v = Math.max(0.05 * volume, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    o.connect(f);
    f.connect(g);
    g.connect(c.destination);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
  }

  var FX = {
    move:   function () { tone(1350, 0.045, "sine", 0.10); },
    edge:   function () { tone(170, 0.07, "triangle", 0.16); },
    select: function () { tone(660, 0.08, "sine", 0.18); tone(990, 0.14, "sine", 0.16, 0.06); },
    back:   function () { tone(720, 0.10, "sine", 0.14, 0, 430); },
    open:   function () { tone(420, 0.16, "sine", 0.14, 0, 860); },
    close:  function () { tone(860, 0.14, "sine", 0.12, 0, 420); },
    error:  function () { tone(300, 0.12, "square", 0.06); tone(220, 0.18, "square", 0.06, 0.12); },
    // Açılış: petek hücreleriyle eş zamanlı yükselen notalar, sonunda kısa bir arı vızıltısı
    boot:   function () {
      var notes = [392, 523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) { tone(notes[i], 0.45, "sine", 0.1, i * 0.09); }
      buzz(0.62, 0.42);
    }
  };

  function play(name) {
    if (!enabled || volume <= 0 || !FX[name]) { return; }
    try { FX[name](); } catch (e) {}
  }

  function set(on, vol) {
    enabled = on;
    volume = vol;
  }

  return { play: play, set: set, unlock: ensure };
})();

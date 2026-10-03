// Chat de voz de las mesas de Jugar Commander.
// Google no deja usar el micrófono dentro del marco de Apps Script, por eso la voz vive aquí, en la
// página de afuera. La mesa (dentro del marco) le pide unirse, silenciar o salir, y le pasa los mensajes
// de conexión que llegan por el servidor; la voz va directo entre los navegadores (WebRTC).
(function () {
  var STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  function Motor(enviar) {
    var mic = null, sid = '', mute = false, yo = '';
    var pares = {};            // idAsiento -> { pc, sidRemoto, audio, ofrezco, ts, estado }
    var ctx = null, medidores = {}, habla = {}, timerHabla = null, bloqueado = false;

    function avisar() {
      var est = {};
      Object.keys(pares).forEach(function (id) { est[id] = pares[id].estado; });
      enviar({ op: 'estado', en: !!mic, sid: sid, mute: mute, pares: est, habla: habla, bloqueado: bloqueado });
    }

    // --- quién está hablando: volumen de cada voz cada 200 ms ---
    function medir(id, stream) {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        medidores[id] = { an: an, buf: new Uint8Array(an.fftSize), src: src };
      } catch (e) { /* sin indicador, la voz igual funciona */ }
      if (!timerHabla) timerHabla = setInterval(revisarHabla, 200);
    }
    function revisarHabla() {
      var cambio = false;
      Object.keys(medidores).forEach(function (id) {
        var m = medidores[id], suma = 0;
        m.an.getByteTimeDomainData(m.buf);
        for (var i = 0; i < m.buf.length; i++) { var v = (m.buf[i] - 128) / 128; suma += v * v; }
        var on = Math.sqrt(suma / m.buf.length) > 0.04 && !(id === yo && mute);
        if (!!habla[id] !== on) { cambio = true; if (on) habla[id] = true; else delete habla[id]; }
      });
      if (cambio) avisar();
    }
    function quitarMedidor(id) {
      var m = medidores[id];
      if (m) { try { m.src.disconnect(); } catch (e) { } delete medidores[id]; }
      delete habla[id];
    }

    // --- conexiones ---
    function cerrar(id) {
      var p = pares[id];
      if (!p) return;
      try { p.pc.close(); } catch (e) { }
      if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
      quitarMedidor(id);
      delete pares[id];
    }
    // Espera a reunir las rutas de conexión (con un tope) y manda la descripción completa en un solo mensaje.
    function cuandoListo(pc) {
      return new Promise(function (ok) {
        if (pc.iceGatheringState === 'complete') return ok();
        var fin = function () { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', fin); ok(); } };
        pc.addEventListener('icegatheringstatechange', fin);
        setTimeout(ok, 3000);
      });
    }
    function nuevo(id, sidRemoto, ofrezco) {
      cerrar(id);
      var pc = new RTCPeerConnection({ iceServers: STUN });
      var p = pares[id] = { pc: pc, sidRemoto: sidRemoto, ofrezco: ofrezco, ts: Date.now(), estado: 'conectando' };
      mic.getTracks().forEach(function (t) { pc.addTrack(t, mic); });
      pc.ontrack = function (e) {
        if (pares[id] !== p) return;
        var st = e.streams[0] || new MediaStream([e.track]);
        if (!p.audio) {
          p.audio = document.createElement('audio');
          p.audio.autoplay = true; p.audio.setAttribute('playsinline', '');
          document.body.appendChild(p.audio);
        }
        p.audio.srcObject = st;
        // si el navegador no deja sonar solo, la mesa muestra "Activar sonido"
        var pr = p.audio.play(); if (pr && pr.catch) pr.catch(function () { bloqueado = true; avisar(); });
        medir(id, st);
      };
      pc.onconnectionstatechange = function () {
        if (pares[id] !== p) return;
        var s = pc.connectionState;
        p.estado = s === 'connected' ? 'ok' : (s === 'failed' || s === 'closed') ? 'falla' : 'conectando';
        if (s === 'failed') p.ts = 0; // el que ofrece reintenta en la próxima revisión
        avisar();
      };
      return p;
    }
    function ofrecer(id, sidRemoto) {
      var p = nuevo(id, sidRemoto, true), pc = p.pc;
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
        .then(function () { return cuandoListo(pc); })
        .then(function () { if (pares[id] === p) enviar({ op: 'enviar', para: id, sid: sidRemoto, d: { t: 'oferta', sdp: pc.localDescription.sdp } }); })
        .catch(function (e) { p.estado = 'falla'; avisar(); });
      avisar();
    }
    function responder(id, sidRemoto, sdp) {
      var p = nuevo(id, sidRemoto, false), pc = p.pc;
      pc.setRemoteDescription({ type: 'offer', sdp: sdp })
        .then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(function () { return cuandoListo(pc); })
        .then(function () { if (pares[id] === p) enviar({ op: 'enviar', para: id, sid: sidRemoto, d: { t: 'respuesta', sdp: pc.localDescription.sdp } }); })
        .catch(function () { p.estado = 'falla'; avisar(); });
      avisar();
    }

    function salir() {
      Object.keys(pares).forEach(cerrar);
      if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
      quitarMedidor(yo);
      mic = null; sid = ''; mute = false; habla = {}; bloqueado = false;
      if (timerHabla) { clearInterval(timerHabla); timerHabla = null; }
      avisar();
    }

    return function recibir(m) {
      if (!m || typeof m !== 'object') return;
      if (m.op === 'unirse') {
        enviar({ op: 'hola' });
        if (mic) return avisar();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
          return enviar({ op: 'error', msg: 'Este navegador no permite chat de voz.' });
        }
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
          .then(function (st) {
            mic = st; mute = false; yo = String(m.yo || '');
            sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            medir(yo, st);
            avisar();
          })
          .catch(function (e) {
            enviar({ op: 'error', msg: e && e.name === 'NotAllowedError'
              ? 'No diste permiso para el micrófono. Actívalo en el candado de la barra de direcciones.'
              : 'No se pudo usar el micrófono (' + (e && e.name || 'error') + ').' });
          });
      } else if (m.op === 'sonido') {
        bloqueado = false;
        if (ctx && ctx.state === 'suspended') ctx.resume();
        Object.keys(pares).forEach(function (id) {
          var a = pares[id].audio;
          if (a) { var pr = a.play(); if (pr && pr.catch) pr.catch(function () { bloqueado = true; avisar(); }); }
        });
        avisar();
      } else if (m.op === 'salir') {
        salir();
      } else if (m.op === 'silenciar') {
        mute = !!m.on;
        if (mic) mic.getAudioTracks().forEach(function (t) { t.enabled = !mute; });
        avisar();
      } else if (m.op === 'pares' && mic) {
        // quién está en la voz ahora: { idAsiento: sid }. Entre cada par, ofrece el de id menor.
        var pres = m.pres || {}, ahora = Date.now();
        Object.keys(pares).forEach(function (id) { if (pres[id] !== pares[id].sidRemoto) cerrar(id); });
        Object.keys(pres).forEach(function (id) {
          var p = pares[id];
          if (yo < id) {
            if (!p || (p.estado !== 'ok' && ahora - p.ts > 15000)) ofrecer(id, pres[id]);
          }
        });
        avisar();
      } else if (m.op === 'senal' && mic && m.d) {
        var id = String(m.de || ''), p = pares[id];
        if (m.d.t === 'oferta') {
          if (p && p.sidRemoto === m.sid && p.sdpOferta === m.d.sdp) return; // la misma oferta repetida
          responder(id, m.sid, m.d.sdp);
          if (pares[id]) pares[id].sdpOferta = m.d.sdp;
        }
        else if (m.d.t === 'respuesta' && p && p.ofrezco && p.sidRemoto === m.sid && p.pc.signalingState === 'have-local-offer') {
          p.pc.setRemoteDescription({ type: 'answer', sdp: m.d.sdp }).catch(function () { p.estado = 'falla'; avisar(); });
        }
      }
    };
  }
  window.MotorVozMTG = Motor;

  // En la página de GitHub: se conecta con la mesa que corre dentro del marco de Apps Script.
  if (document.getElementById('app')) {
    var destino = null;
    var recibir = Motor(function (msg) {
      if (!destino) return;
      msg.tipo = 'mtg-voz';
      try { destino.src.postMessage(msg, destino.origin); } catch (e) { }
    });
    window.addEventListener('message', function (e) {
      if (!/^https:\/\/[a-z0-9-]+[.-]script\.googleusercontent\.com$/.test(e.origin)) return;
      if (!e.data || e.data.tipo !== 'mtg-voz') return;
      destino = { src: e.source, origin: e.origin };
      recibir(e.data);
    });
  }
})();

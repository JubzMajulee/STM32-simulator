import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Cpu,
  Layers,
  Layout,
  Terminal,
  Zap,
  Activity,
  Play,
  Pause,
  RefreshCw,
  Send,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Lightbulb
} from 'lucide-react';

// ProtoPie Connect's Socket.IO bridge endpoint. Override with VITE_PROTOPIE_URL.
const PROTOPIE_URL = import.meta.env.VITE_PROTOPIE_URL || 'http://localhost:9981';

const Card = ({ title, icon: Icon, children, color }) => (
  <div className={`bg-slate-900 border ${color || 'border-slate-700'} rounded-xl p-4 shadow-xl flex flex-col h-full`}>
    <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-2">
      <Icon className={color ? 'text-blue-400' : 'text-slate-400'} size={20} />
      <h3 className="font-bold text-slate-200 uppercase tracking-wider text-sm">{title}</h3>
    </div>
    <div className="flex-1 overflow-hidden">
      {children}
    </div>
  </div>
);

const App = () => {
  const [temp, setTemp] = useState(25);
  const [lastSentTemp, setLastSentTemp] = useState(25);
  const [ledOn, setLedOn] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testValue, setTestValue] = useState(101);
  const [bridgeLogs, setBridgeLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('system');
  const [uiState, setUiState] = useState('NORMAL');
  const [terminalInput, setTerminalInput] = useState('');
  const [pieStatus, setPieStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'disconnected'
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialError, setSerialError] = useState('');
  const [pieUrlInput, setPieUrlInput] = useState(() => {
    try { return localStorage.getItem('pieUrl') || ''; } catch { return ''; }
  });
  const [pieUrl, setPieUrl] = useState(() => {
    try { return localStorage.getItem('pieUrl') || ''; } catch { return ''; }
  });

  const loadPie = () => {
    const v = pieUrlInput.trim();
    setPieUrl(v);
    try {
      if (v) localStorage.setItem('pieUrl', v);
      else localStorage.removeItem('pieUrl');
    } catch { /* localStorage may be blocked */ }
  };

  const clearPie = () => {
    setPieUrl('');
    setPieUrlInput('');
    try { localStorage.removeItem('pieUrl'); } catch { /* noop */ }
  };

  const logEndRef = useRef(null);
  const socketRef = useRef(null);
  const handlingInbound = useRef(false);
  const ledOnRef = useRef(false);
  useEffect(() => { ledOnRef.current = ledOn; }, [ledOn]);

  const serialPortRef = useRef(null);
  const serialReaderRef = useRef(null);
  const serialWriterRef = useRef(null);
  const serialReadAbortRef = useRef(false);
  const serialConnectedRef = useRef(false);
  useEffect(() => { serialConnectedRef.current = serialConnected; }, [serialConnected]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bridgeLogs]);

  useEffect(() => {
    if (serialConnected) return; // Arduino is the source of truth, skip the local sim
    const interval = setInterval(() => {
      const currentVal = testMode ? testValue : temp + (Math.random() * 2 - 1);

      if (!testMode) setTemp(currentVal);

      const thresholdCrossed = (currentVal > 100 && lastSentTemp <= 100) || (currentVal <= 100 && lastSentTemp > 100);
      const significantChange = Math.abs(currentVal - lastSentTemp) > 1.5;

      if (significantChange || thresholdCrossed) {
        sendToBridge(`RPT:TEMP:${currentVal.toFixed(1)}`);
        setLastSentTemp(currentVal);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [temp, testMode, testValue, lastSentTemp, serialConnected]);

  // ProtoPie Connect Socket.IO lifecycle
  useEffect(() => {
    setPieStatus('connecting');
    const sock = io(PROTOPIE_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1500,
    });
    socketRef.current = sock;

    const onConnect = () => {
      setPieStatus('connected');
      setBridgeLogs(prev => [...prev.slice(-19), {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        direction: 'OUT',
        content: `CONNECT:${PROTOPIE_URL}`,
        source: 'PROTOPIE',
      }]);
    };
    const onDisconnect = () => setPieStatus('disconnected');
    const onConnectError = () => setPieStatus('disconnected');

    const onPpMessage = ({ messageId, value }) => {
      // Idempotency guard — drop redundant led commands so a runaway ProtoPie
      // trigger (e.g. While-Touch) doesn't flood the log or loop the bridge.
      if (messageId === 'led') {
        const v = String(value).trim().toLowerCase();
        if (v === 'on' && ledOnRef.current) return;
        if (v === 'off' && !ledOnRef.current) return;
      }
      handlingInbound.current = true;
      try {
        setBridgeLogs(prev => [...prev.slice(-19), {
          id: Date.now() + Math.random(),
          time: new Date().toLocaleTimeString(),
          direction: 'IN',
          content: `${messageId}=${value}`,
          source: 'PROTOPIE',
        }]);
        // Map ProtoPie events → simulator state
        if (messageId === 'setTemp') handleManualCommand(`SET:VAL:${value}`);
        else if (messageId === 'testMode') handleManualCommand(`SET:TEST:${String(value).toUpperCase()}`);
        else if (messageId === 'toggleLight') handleManualCommand('CMD:LIGHT:TOGGLE');
        else if (messageId === 'led') {
          const v = String(value).trim().toLowerCase();
          if (v === 'on') handleManualCommand('CMD:LIGHT:ON');
          else if (v === 'off') handleManualCommand('CMD:LIGHT:OFF');
          else if (v === 'toggle') handleManualCommand('CMD:LIGHT:TOGGLE');
        }
        else if (messageId === 'cmd') handleManualCommand(String(value));
      } finally {
        // Reset on next tick so any synchronous forwardToProtoPie calls in this
        // handler chain are suppressed, but unrelated future emits aren't.
        setTimeout(() => { handlingInbound.current = false; }, 0);
      }
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('connect_error', onConnectError);
    sock.on('ppMessage', onPpMessage);

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('connect_error', onConnectError);
      sock.off('ppMessage', onPpMessage);
      sock.disconnect();
    };
  }, []);

  const handleSerialLine = (line) => {
    if (line.startsWith('RPT:TEMP:')) {
      const v = parseFloat(line.split(':')[2]);
      if (!Number.isNaN(v)) {
        setTemp(v);
        setLastSentTemp(v);
      }
    } else if (line === 'ACK:LIGHT:ON') {
      setLedOn(true);
    } else if (line === 'ACK:LIGHT:OFF') {
      setLedOn(false);
    }
    sendToBridge(line);
  };

  const writeSerialLine = async (line) => {
    const writer = serialWriterRef.current;
    if (!writer) return;
    try {
      await writer.write(new TextEncoder().encode(line + '\n'));
    } catch (err) {
      setSerialError(err.message || String(err));
    }
  };

  const runReadLoop = async () => {
    const reader = serialReaderRef.current;
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (!serialReadAbortRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '').trim();
          buf = buf.slice(idx + 1);
          if (line) handleSerialLine(line);
        }
      }
    } catch (err) {
      if (!serialReadAbortRef.current) setSerialError(err.message || String(err));
    } finally {
      setSerialConnected(false);
    }
  };

  const connectSerial = async () => {
    try {
      setSerialError('');
      if (!('serial' in navigator)) {
        setSerialError('Web Serial API not supported. Use Chrome, Edge, or Opera.');
        return;
      }
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      serialWriterRef.current = port.writable.getWriter();
      serialReaderRef.current = port.readable.getReader();
      serialReadAbortRef.current = false;
      setSerialConnected(true);
      runReadLoop();
    } catch (err) {
      if (err && err.name === 'NotFoundError') return; // user cancelled the picker
      setSerialError(err.message || String(err));
    }
  };

  const disconnectSerial = async () => {
    serialReadAbortRef.current = true;
    try { await serialReaderRef.current?.cancel(); } catch { /* noop */ }
    try { serialReaderRef.current?.releaseLock(); } catch { /* noop */ }
    try { await serialWriterRef.current?.close(); } catch { /* noop */ }
    try { serialWriterRef.current?.releaseLock(); } catch { /* noop */ }
    try { await serialPortRef.current?.close(); } catch { /* noop */ }
    serialReaderRef.current = null;
    serialWriterRef.current = null;
    serialPortRef.current = null;
    setSerialConnected(false);
  };

  useEffect(() => () => { disconnectSerial(); }, []);

  const sendToBridge = (msg) => {
    const logMsg = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      direction: 'IN',
      content: msg,
      source: 'STM32'
    };
    setBridgeLogs(prev => [...prev.slice(-19), logMsg]);
    processToUi(msg);
    forwardToProtoPie(msg);
  };

  // Map raw bridge messages → ProtoPie Connect ppMessages
  const forwardToProtoPie = (msg) => {
    const sock = socketRef.current;
    if (!sock || !sock.connected) return;
    // Don't echo back to ProtoPie while we're handling a message it just sent
    if (handlingInbound.current) return;
    if (msg.startsWith('RPT:TEMP:')) {
      sock.emit('ppMessage', { messageId: 'temperature', value: msg.split(':')[2] });
    } else if (msg.startsWith('ACK:LIGHT:')) {
      sock.emit('ppMessage', { messageId: 'led', value: msg.split(':')[2] });
    }
    // Always forward the raw line for debugging in ProtoPie
    sock.emit('ppMessage', { messageId: 'bridge', value: msg });
  };

  const processToUi = (msg) => {
    if (msg.startsWith('RPT:TEMP:')) {
      const val = parseFloat(msg.split(':')[2]);
      if (val > 100) setUiState('CRITICAL');
      else if (val > 80) setUiState('WARNING');
      else setUiState('NORMAL');
    }
  };

  const handleManualCommand = (rawCmd) => {
    const cmd = (rawCmd || '').trim();
    if (!cmd) return;

    // User-friendly shortcuts → canonical UART format
    let normalized = cmd;
    if (/^-?\d+(\.\d+)?$/.test(cmd)) {
      normalized = `SET:VAL:${cmd}`;
    } else if (/^light:on$/i.test(cmd)) {
      normalized = 'CMD:LIGHT:ON';
    } else if (/^light:off$/i.test(cmd)) {
      normalized = 'CMD:LIGHT:OFF';
    } else if (/^light:toggle$/i.test(cmd)) {
      normalized = 'CMD:LIGHT:TOGGLE';
    }

    const logMsg = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      direction: 'OUT',
      content: normalized,
      source: 'USER/TERM'
    };
    setBridgeLogs(prev => [...prev.slice(-19), logMsg]);

    // When the real Arduino is connected, hand the command off to it and let it
    // respond. Local state updates and synthetic ACKs are skipped — the read
    // loop will pick up the Arduino's RPT/ACK and update state from there.
    if (serialConnectedRef.current) {
      writeSerialLine(normalized);
      // Keep local testValue in sync so the slider/button labels reflect what
      // we just commanded; the actual temperature reading comes back from the
      // Arduino as RPT:TEMP and overwrites `temp` directly.
      if (normalized.startsWith('SET:VAL:')) {
        const val = parseFloat(normalized.split(':')[2]);
        if (!Number.isNaN(val)) setTestValue(val);
      }
      if (normalized.startsWith('SET:TEST:ON')) setTestMode(true);
      if (normalized.startsWith('SET:TEST:OFF')) setTestMode(false);
      return;
    }

    if (normalized.startsWith('SET:TEST:ON')) setTestMode(true);
    if (normalized.startsWith('SET:TEST:OFF')) setTestMode(false);
    if (normalized.startsWith('SET:VAL:')) {
      const val = parseFloat(normalized.split(':')[2]);
      if (!Number.isNaN(val)) {
        setTestValue(val);
        if (!testMode) setTestMode(true);
      }
    }
    if (normalized === 'CMD:LIGHT:ON') {
      setLedOn(true);
      sendToBridge('ACK:LIGHT:ON');
    } else if (normalized === 'CMD:LIGHT:OFF') {
      setLedOn(false);
      sendToBridge('ACK:LIGHT:OFF');
    } else if (normalized === 'CMD:LIGHT:TOGGLE') {
      setLedOn(!ledOn);
      sendToBridge(`ACK:LIGHT:${!ledOn ? 'ON' : 'OFF'}`);
    }
  };

  const submitTerminal = () => {
    handleManualCommand(terminalInput);
    setTerminalInput('');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans p-4 md:p-8">
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <Zap className="text-yellow-400 fill-yellow-400" />
            HIL SYSTEM SIMULATOR
          </h1>
          <p className="text-slate-500 mt-1">Decoupling Firmware from UI via Middleware Bridge</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setBridgeLogs([]); setTemp(25); setUiState('NORMAL'); }}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition"
          >
            <RefreshCw size={18} /> Reset System
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 h-[700px] auto-rows-fr">

        <Card title="STM32 Microcontroller" icon={Cpu} color="border-blue-500/30">
          <div className="space-y-6">
            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full shrink-0 ${serialConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`} />
              <span className="text-[11px] font-mono flex-1 truncate text-slate-300">
                {serialConnected ? 'Arduino · Live (USB)' : 'Arduino · Disconnected'}
              </span>
              <button
                onClick={serialConnected ? disconnectSerial : connectSerial}
                className={`text-[10px] font-bold py-1 px-2 rounded border transition ${serialConnected
                  ? 'bg-red-900/40 border-red-700 text-red-300 hover:bg-red-900/60'
                  : 'bg-blue-900/40 border-blue-700 text-blue-300 hover:bg-blue-900/60'}`}
              >
                {serialConnected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
            {serialError && (
              <div className="text-[10px] text-red-400 font-mono -mt-3">⚠ {serialError}</div>
            )}
            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-500 font-mono">SENSOR_DATA</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  serialConnected
                    ? (testMode ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-300')
                    : (testMode ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400')
                }`}>
                  {serialConnected
                    ? (testMode ? 'TEST (ARDUINO)' : 'LIVE (POT)')
                    : (testMode ? 'SIMULATED' : 'REAL-TIME (SIM)')}
                </span>
              </div>
              <div className="text-4xl font-mono text-white text-center py-4 bg-black/30 rounded-md border border-slate-900">
                {(serialConnected ? temp : (testMode ? testValue : temp)).toFixed(1)}°C
              </div>
            </div>

            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
              <span className="text-xs text-slate-500 font-mono block mb-2">HARDWARE_OUTPUT (GPIO)</span>
              <div className="flex items-center justify-center gap-6 py-2">
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${ledOn ? 'bg-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.5)]' : 'bg-slate-900 shadow-inner'}`}>
                    <Lightbulb className={ledOn ? 'text-slate-900' : 'text-slate-700'} size={24} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">LED_PIN_5</span>
                </div>
              </div>
            </div>

            <div className="text-[11px] font-mono bg-black p-3 rounded border border-slate-800 text-green-500 overflow-hidden opacity-80">
              <div className="animate-pulse mb-1">// MAIN_LOOP_RUNNING</div>
              <div className="text-slate-400">if (testMode) {'{'} temp = manualVal; {'}'}</div>
              <div className="text-slate-400">if (temp &gt; 100) {'{'} UART_Send("RPT:TEMP..."); {'}'}</div>
            </div>
          </div>
        </Card>

        <Card title="Bridge Gateway (Node.js)" icon={Layers} color="border-purple-500/30">
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-0 bg-black rounded p-3 font-mono text-[11px] overflow-y-auto border border-slate-800 mb-4">
              {bridgeLogs.length === 0 && <div className="text-slate-700 italic">Waiting for serial data...</div>}
              {bridgeLogs.map(log => (
                <div key={log.id} className={`mb-1 flex items-start gap-2 ${log.direction === 'IN' ? 'text-blue-400' : 'text-purple-400'}`}>
                  <span className="text-slate-600">[{log.time}]</span>
                  <span className="font-bold">{log.direction === 'IN' ? '←' : '→'}</span>
                  <span>{log.content}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Terminal Override</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleManualCommand(testMode ? 'SET:TEST:OFF' : 'SET:TEST:ON')}
                    className={`text-[11px] font-bold py-2 rounded border transition ${testMode ? 'bg-purple-600 border-purple-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}
                  >
                    TEST_MODE: {testMode ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => handleManualCommand(`SET:VAL:${testValue === 101 ? 25 : 101}`)}
                    className="text-[11px] font-bold py-2 rounded border bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700"
                  >
                    TOGGLE_VALUE ({testValue === 101 ? '25' : '101'})
                  </button>
                </div>
              </div>
              <div>
                <div className="relative">
                  <input
                    type="text"
                    value={terminalInput}
                    onChange={(e) => setTerminalInput(e.target.value)}
                    placeholder="e.g. 75  •  light:on  •  light:off"
                    className="w-full bg-black border border-slate-700 rounded-lg pl-3 pr-9 py-2 text-xs font-mono focus:border-purple-500 outline-none text-white"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitTerminal();
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitTerminal}
                    aria-label="Send command"
                    className="absolute right-1 top-1 bottom-1 px-2 rounded text-slate-500 hover:text-purple-400 hover:bg-slate-800/60"
                  >
                    <Send size={14} />
                  </button>
                </div>
                <div className="text-[10px] text-slate-600 mt-1.5 font-mono">
                  Type a number for °C · light:on · light:off
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Product UI (ProtoPie)" icon={Layout} color="border-green-500/30">
          <div className="flex flex-col h-full gap-4">
            {!pieUrl ? (
              <div
                id="protopie-stage-slot"
                className="flex-1 min-h-0 rounded-2xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center gap-3 p-4"
              >
                <span className="text-[10px] font-mono uppercase text-slate-600 tracking-widest">
                  ProtoPie URL
                </span>
                <input
                  type="text"
                  value={pieUrlInput}
                  onChange={(e) => setPieUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadPie(); }}
                  placeholder="https://cloud.protopie.io/p/..."
                  className="w-full bg-black border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono focus:border-green-500 outline-none text-white"
                />
                <button
                  onClick={loadPie}
                  disabled={!pieUrlInput.trim()}
                  className="bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs px-4 py-2 rounded transition"
                >
                  Load Pie
                </button>
                <span className="text-[9px] text-slate-600 text-center">
                  Paste a Pie share URL or local Connect preview link.
                </span>
              </div>
            ) : (
              <div
                id="protopie-stage-slot"
                className="flex-1 min-h-0 relative rounded-2xl overflow-hidden bg-black border border-slate-700"
              >
                <iframe
                  src={pieUrl}
                  title="ProtoPie"
                  className="w-full h-full block border-0"
                  allow="autoplay; clipboard-read; clipboard-write; gyroscope; accelerometer; microphone; camera"
                  referrerPolicy="no-referrer"
                />
                <button
                  onClick={clearPie}
                  className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white text-[10px] font-bold px-2 py-1 rounded border border-slate-700"
                >
                  Change URL
                </button>
              </div>
            )}

            <div className={`p-3 rounded-lg border flex items-center justify-between gap-3 transition-colors ${
              pieStatus === 'connected'
                ? 'bg-green-950/40 border-green-700'
                : pieStatus === 'connecting'
                  ? 'bg-yellow-950/40 border-yellow-700'
                  : 'bg-red-950/40 border-red-800'
            }`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  pieStatus === 'connected'
                    ? 'bg-green-500 animate-pulse'
                    : pieStatus === 'connecting'
                      ? 'bg-yellow-400 animate-pulse'
                      : 'bg-red-500'
                }`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  pieStatus === 'connected' ? 'text-green-400'
                    : pieStatus === 'connecting' ? 'text-yellow-300'
                      : 'text-red-400'
                }`}>
                  {pieStatus === 'connected' && 'Connected to ProtoPie'}
                  {pieStatus === 'connecting' && 'Connecting…'}
                  {pieStatus === 'disconnected' && 'ProtoPie not reachable'}
                </span>
              </div>
              <span className="text-[9px] font-mono text-slate-500 truncate" title={PROTOPIE_URL}>{PROTOPIE_URL.replace(/^https?:\/\//, '')}</span>
            </div>
          </div>
        </Card>

      </main>
    </div>
  );
};

export default App;

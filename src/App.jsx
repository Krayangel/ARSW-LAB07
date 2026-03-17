import { useEffect, useRef, useState, useCallback } from 'react'
import { createStompClient, subscribeBlueprint } from './lib/stompClient.js'
import { createSocket } from './lib/socketIoClient.js'

// ── Variables de entorno ──────────────────────────────────────────────────────
const API_BASE   = import.meta.env.VITE_API_BASE   ?? 'http://localhost:8080'
const IO_BASE    = import.meta.env.VITE_IO_BASE    ?? 'http://localhost:3001'
const STOMP_BASE = import.meta.env.VITE_STOMP_BASE ?? 'http://localhost:8080'

// ── Helpers REST ──────────────────────────────────────────────────────────────
const restBase = (tech) => tech === 'stomp' ? API_BASE : IO_BASE

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  if (res.status === 204) return null
  return res.json()
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function App() {
  // Selector de tecnología RT
  const [tech, setTech] = useState('stomp') // 'none' | 'stomp' | 'socketio'

  // Selector de plano activo
  const [author, setAuthor] = useState('juan')
  const [bpName, setBpName] = useState('plano-1')

  // Lista de planos del autor (panel lateral)
  const [blueprints, setBlueprints] = useState([])

  // Puntos del plano activo (canvas)
  const [points, setPoints] = useState([])

  // Estado UI
  const [status, setStatus] = useState('Listo')
  const [rtConnected, setRtConnected] = useState(false)

  // Formulario crear plano
  const [newAuthor, setNewAuthor] = useState('juan')
  const [newName, setNewName]     = useState('')

  // Refs para canvas y clientes RT
  const canvasRef  = useRef(null)
  const stompRef   = useRef(null)
  const unsubRef   = useRef(null)
  const socketRef  = useRef(null)
  const pointsRef  = useRef([]) // ref sincronizada con points para usar en callbacks RT

  // ── Sincronizar ref con state ───────────────────────────────────────────────
  useEffect(() => { pointsRef.current = points }, [points])

  // ── Dibujar en canvas cada vez que cambian los puntos ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (points.length === 0) return

    // Dibuja línea continua
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth   = 2
    ctx.lineJoin    = 'round'
    ctx.lineCap     = 'round'
    ctx.beginPath()
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()

    // Dibuja puntos individuales
    ctx.fillStyle = '#dc2626'
    points.forEach((p) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fill()
    })
  }, [points])

  // ── Cargar lista de planos del autor ────────────────────────────────────────
  const loadAuthorBlueprints = useCallback(async (targetAuthor) => {
    try {
      const base = restBase(tech)
      const data = await apiFetch(`${base}/api/blueprints?author=${targetAuthor}`)
      setBlueprints(data ?? [])
    } catch (e) {
      console.error('loadAuthorBlueprints', e)
      setBlueprints([])
    }
  }, [tech])

  // ── Cargar puntos de un plano específico ────────────────────────────────────
  const loadBlueprint = useCallback(async (a, n) => {
    try {
      setStatus(`Cargando ${a}/${n}…`)
      const base = restBase(tech)
      const data = await apiFetch(`${base}/api/blueprints/${a}/${n}`)
      setPoints(data.points ?? [])
      setStatus(`Plano ${a}/${n} cargado (${(data.points ?? []).length} pts)`)
    } catch (e) {
      console.error('loadBlueprint', e)
      setStatus(`Error al cargar ${a}/${n}: ${e.message}`)
      setPoints([])
    }
  }, [tech])

  // ── Al cambiar author → recargar lista ──────────────────────────────────────
  useEffect(() => {
    if (author.trim()) loadAuthorBlueprints(author)
  }, [author, tech])

  // ── Al cambiar plano → recargar puntos ──────────────────────────────────────
  useEffect(() => {
    if (author.trim() && bpName.trim()) loadBlueprint(author, bpName)
  }, [author, bpName, tech])

  // ── Gestión de conexión RT ──────────────────────────────────────────────────
  useEffect(() => {
    // Limpiar conexión anterior
    unsubRef.current?.()
    unsubRef.current = null
    stompRef.current?.deactivate?.()
    stompRef.current = null
    socketRef.current?.disconnect?.()
    socketRef.current = null
    setRtConnected(false)

    if (tech === 'none' || !author.trim() || !bpName.trim()) return

    if (tech === 'stomp') {
      const client = createStompClient(STOMP_BASE)
      stompRef.current = client

      client.onConnect = () => {
        setRtConnected(true)
        setStatus(`STOMP conectado — escuchando ${author}/${bpName}`)
        // Suscribirse al tópico del plano activo
        unsubRef.current = subscribeBlueprint(client, author, bpName, (upd) => {
          // Reemplaza todos los puntos con lo que llega del servidor
          setPoints(upd.points ?? [])
        })
      }

      client.onDisconnect = () => {
        setRtConnected(false)
        setStatus('STOMP desconectado')
      }

      client.activate()

    } else if (tech === 'socketio') {
      const s = createSocket(IO_BASE)
      socketRef.current = s

      s.on('connect', () => {
        setRtConnected(true)
        const room = `blueprints.${author}.${bpName}`
        s.emit('join-room', room)
        setStatus(`Socket.IO conectado — sala: ${room}`)
      })

      s.on('blueprint-update', (upd) => {
        setPoints(upd.points ?? [])
      })

      s.on('disconnect', () => {
        setRtConnected(false)
        setStatus('Socket.IO desconectado')
      })
    }

    return () => {
      unsubRef.current?.()
      unsubRef.current = null
      stompRef.current?.deactivate?.()
      socketRef.current?.disconnect?.()
    }
  }, [tech, author, bpName])

  // ── Click en canvas → enviar punto ─────────────────────────────────────────
  const handleCanvasClick = (e) => {
    const rect = e.target.getBoundingClientRect()
    const point = {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    }

    if (tech === 'stomp' && stompRef.current?.connected) {
      // Envía por STOMP — el servidor acumula y hace broadcast
      stompRef.current.publish({
        destination: '/app/draw',
        body: JSON.stringify({ author, name: bpName, point }),
      })
    } else if (tech === 'socketio' && socketRef.current?.connected) {
      // Envía por Socket.IO
      const room = `blueprints.${author}.${bpName}`
      socketRef.current.emit('draw-event', { room, author, name: bpName, point })
    } else {
      // Sin RT: solo actualiza localmente
      setPoints((prev) => [...prev, point])
    }
  }

  // ── CRUD handlers ───────────────────────────────────────────────────────────

  // CREATE — crea un plano nuevo vacío
  const handleCreate = async () => {
    const n = newName.trim()
    const a = newAuthor.trim()
    if (!a || !n) return alert('Completa autor y nombre del plano')
    try {
      const base = restBase(tech)
      await apiFetch(`${base}/api/blueprints`, {
        method: 'POST',
        body: JSON.stringify({ author: a, name: n, points: [] }),
      })
      setStatus(`Plano ${a}/${n} creado`)
      setNewName('')
      if (a === author) {
        await loadAuthorBlueprints(author)
        setAuthor(a)
        setBpName(n)
      }
    } catch (e) {
      setStatus(`Error al crear: ${e.message}`)
    }
  }

  // SAVE/UPDATE — guarda los puntos actuales del canvas
  const handleSave = async () => {
    try {
      const base = restBase(tech)
      await apiFetch(`${base}/api/blueprints/${author}/${bpName}`, {
        method: 'PUT',
        body: JSON.stringify({ author, name: bpName, points }),
      })
      setStatus(`Plano ${author}/${bpName} guardado (${points.length} pts)`)
      await loadAuthorBlueprints(author)
    } catch (e) {
      setStatus(`Error al guardar: ${e.message}`)
    }
  }

  // DELETE — elimina el plano activo
  const handleDelete = async () => {
    if (!confirm(`¿Eliminar ${author}/${bpName}?`)) return
    try {
      const base = restBase(tech)
      await apiFetch(`${base}/api/blueprints/${author}/${bpName}`, { method: 'DELETE' })
      setStatus(`Plano ${author}/${bpName} eliminado`)
      setPoints([])
      await loadAuthorBlueprints(author)
      // Selecciona el primero disponible si hay
      setBlueprints((prev) => {
        if (prev.length > 0) setBpName(prev[0].name)
        return prev
      })
    } catch (e) {
      setStatus(`Error al eliminar: ${e.message}`)
    }
  }

  // ── Totales (reduce) ────────────────────────────────────────────────────────
  const totalPoints = blueprints.reduce((acc, bp) => acc + (bp.totalPoints ?? 0), 0)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>🗺️ BluePrints RT — Socket.IO vs STOMP</h2>

      {/* ── Barra de control ── */}
      <div style={styles.toolbar}>
        <label style={styles.label}>Tecnología RT:</label>
        <select
          value={tech}
          onChange={(e) => setTech(e.target.value)}
          style={styles.select}
        >
          <option value="none">None (solo local)</option>
          <option value="stomp">STOMP (Spring)</option>
          <option value="socketio">Socket.IO (Node)</option>
        </select>

        <span style={{
          ...styles.badge,
          background: rtConnected ? '#16a34a' : '#9ca3af',
        }}>
          {rtConnected ? '● Conectado' : '○ Desconectado'}
        </span>

        <label style={styles.label}>Autor:</label>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          style={styles.input}
          placeholder="autor"
        />

        <label style={styles.label}>Plano:</label>
        <input
          value={bpName}
          onChange={(e) => setBpName(e.target.value)}
          style={styles.input}
          placeholder="nombre"
        />
      </div>

      {/* ── Layout principal ── */}
      <div style={styles.main}>

        {/* ── Panel izquierdo: tabla de planos ── */}
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Planos de "{author}"</h3>
          <p style={styles.totalLabel}>
            Total de puntos: <strong>{totalPoints}</strong>
          </p>

          {blueprints.length === 0
            ? <p style={styles.empty}>Sin planos</p>
            : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Nombre</th>
                    <th style={styles.th}>Puntos</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {blueprints.map((bp) => (
                    <tr
                      key={bp.name}
                      style={{
                        background: bp.name === bpName ? '#eff6ff' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => setBpName(bp.name)}
                    >
                      <td style={styles.td}>{bp.name}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{bp.totalPoints}</td>
                      <td style={styles.td}>
                        {bp.name === bpName && (
                          <span style={styles.activeDot}>▶</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }

          {/* Crear plano nuevo */}
          <div style={styles.createSection}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>Crear plano</h4>
            <input
              value={newAuthor}
              onChange={(e) => setNewAuthor(e.target.value)}
              placeholder="autor"
              style={{ ...styles.input, width: '100%', marginBottom: 4 }}
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="nombre del plano"
              style={{ ...styles.input, width: '100%', marginBottom: 4 }}
            />
            <button onClick={handleCreate} style={{ ...styles.btn, background: '#2563eb', width: '100%' }}>
              ➕ Crear
            </button>
          </div>
        </div>

        {/* ── Panel derecho: canvas ── */}
        <div style={styles.canvasArea}>
          <canvas
            ref={canvasRef}
            width={600}
            height={400}
            style={styles.canvas}
            onClick={handleCanvasClick}
          />
          <p style={styles.hint}>
            {tech === 'none'
              ? '⚠️ Modo local: los clics no se sincronizan. Elige STOMP o Socket.IO para RT.'
              : '💡 Haz clic en el canvas para agregar puntos. Abre 2 pestañas para ver colaboración.'}
          </p>

          {/* Acciones CRUD */}
          <div style={styles.actions}>
            <button onClick={handleSave}   style={{ ...styles.btn, background: '#16a34a' }}>
              💾 Guardar / Actualizar
            </button>
            <button onClick={handleDelete} style={{ ...styles.btn, background: '#dc2626' }}>
              🗑️ Eliminar
            </button>
            <button
              onClick={() => { setPoints([]); setStatus('Canvas limpio (sin guardar)') }}
              style={{ ...styles.btn, background: '#6b7280' }}
            >
              🧹 Limpiar canvas
            </button>
          </div>

          {/* Barra de estado */}
          <div style={styles.statusBar}>
            {status} — {points.length} punto(s) en canvas
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Estilos inline ────────────────────────────────────────────────────────────
const styles = {
  container: {
    fontFamily: 'Inter, system-ui, sans-serif',
    padding: 20,
    maxWidth: 1000,
    margin: '0 auto',
    color: '#111827',
  },
  title: {
    margin: '0 0 12px',
    fontSize: 22,
    fontWeight: 700,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginBottom: 16,
    padding: 12,
    background: '#f9fafb',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
  },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  select: { padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 },
  input:  { padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, width: 100 },
  badge:  { fontSize: 12, padding: '2px 8px', borderRadius: 99, color: '#fff', fontWeight: 600 },
  main: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
  },
  panel: {
    width: 220,
    flexShrink: 0,
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
  },
  panelTitle: { margin: '0 0 6px', fontSize: 14, fontWeight: 700 },
  totalLabel: { fontSize: 12, color: '#6b7280', margin: '0 0 8px' },
  empty: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 },
  th: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: '#374151' },
  td: { padding: '4px 6px', borderBottom: '1px solid #f3f4f6', color: '#111827' },
  activeDot: { color: '#2563eb', fontWeight: 700 },
  createSection: { marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' },
  canvasArea: { flex: 1 },
  canvas: {
    border: '1.5px solid #d1d5db',
    borderRadius: 10,
    cursor: 'crosshair',
    display: 'block',
    background: '#ffffff',
  },
  hint: { fontSize: 12, color: '#6b7280', margin: '6px 0 10px' },
  actions: { display: 'flex', gap: 8, marginBottom: 8 },
  btn: {
    padding: '7px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
  },
  statusBar: {
    fontSize: 12,
    color: '#374151',
    background: '#f3f4f6',
    borderRadius: 6,
    padding: '6px 10px',
    border: '1px solid #e5e7eb',
  },
}
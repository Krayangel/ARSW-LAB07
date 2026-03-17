import { io } from 'socket.io-client'

/**
 * Crea y devuelve un socket Socket.IO.
 * Forzamos WebSocket para evitar polling.
 * @param {string} baseUrl - ej: "http://localhost:3001"
 */
export function createSocket(baseUrl) {
  const socket = io(baseUrl, {
    transports: ['websocket'],
    reconnectionDelay: 3000,
  })
  socket.on('connect', () => console.log('[Socket.IO] conectado', socket.id))
  socket.on('disconnect', (r) => console.log('[Socket.IO] desconectado', r))
  socket.on('connect_error', (e) => console.error('[Socket.IO] error', e.message))
  return socket
}
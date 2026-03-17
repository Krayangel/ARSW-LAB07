import { Client } from '@stomp/stompjs'

/**
 * Crea y devuelve un cliente STOMP configurado.
 * @param {string} baseUrl - ej: "http://localhost:8080"
 */
export function createStompClient(baseUrl) {
  const wsUrl = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws-blueprints'
  const client = new Client({
    brokerURL: wsUrl,
    // Si usas SockJS descomenta las dos líneas siguientes y comenta brokerURL:
    // webSocketFactory: () => new SockJS(`${baseUrl}/ws-blueprints`),
    reconnectDelay: 3000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    onStompError: (frame) => {
      console.error('[STOMP] Error:', frame.headers['message'])
    },
    debug: (str) => console.debug('[STOMP]', str),
  })
  return client
}

/**
 * Suscribe al tópico de un plano específico.
 * @returns función de cancelación (unsub)
 */
export function subscribeBlueprint(client, author, name, onMsg) {
  const sub = client.subscribe(
    `/topic/blueprints.${author}.${name}`,
    (message) => {
      try {
        onMsg(JSON.parse(message.body))
      } catch (e) {
        console.error('[STOMP] parse error', e)
      }
    }
  )
  return () => sub.unsubscribe()
}
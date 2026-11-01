/**
 * Offline demo content for LLM_PROVIDER=mock.
 *
 * This is exactly the JSON the real agents produce, hand-written for
 * "TCP 3-Way Handshake", so the whole loop (diagnostic → lesson → notes →
 * teach-back → scorecard → disputes) can be demoed with no API key and no
 * network. It also doubles as a reference for what good agent output looks like.
 */
import type { z } from "zod";
import { LessonDraft, RubricItem as RubricItemSchema, type DiagnosticQuestion, type Difficulty, type RubricItem } from "@/lib/schemas";

const SRC = "seed:tcp-three-way-handshake#";

export const TCP_TOPIC = "TCP 3-Way Handshake";

export const tcpDiagnostic: DiagnosticQuestion[] = [
  {
    id: "d1",
    depth: "mental-model",
    concept: "Purpose of the handshake",
    prompt: "Before any data is sent, what is the main thing the TCP handshake establishes?",
    options: [
      "Each side's initial sequence number, synchronized in both directions",
      "The encryption keys for the connection",
      "The fastest route through the network",
      "The maximum bandwidth of the link",
    ],
    correctIndex: 0,
  },
  {
    id: "d2",
    depth: "mechanism",
    concept: "Segment order",
    prompt: "Which sequence of flags opens a normal TCP connection?",
    options: ["SYN → ACK → SYN", "SYN → SYN-ACK → ACK", "ACK → SYN → FIN", "SYN → SYN → ACK-ACK"],
    correctIndex: 1,
  },
  {
    id: "d3",
    depth: "implementation",
    concept: "Acknowledgment numbers",
    prompt: "The client's SYN carries sequence number x. What acknowledgment number does the server put in its SYN-ACK?",
    options: ["x", "x + 1", "0", "A random number unrelated to x"],
    correctIndex: 1,
  },
  {
    id: "d4",
    depth: "implementation",
    concept: "Server state under attack",
    prompt: "During a SYN flood, what resource on the server gets exhausted first?",
    options: [
      "Outbound bandwidth",
      "The queue of half-open connections waiting for the final ACK",
      "The TLS session cache",
      "Disk space for logs",
    ],
    correctIndex: 1,
  },
];

const rawLesson: z.input<typeof LessonDraft> = {
  title: "TCP 3-Way Handshake, hands-on",
  summary:
    "How two machines agree on sequence numbers before sending data, what each segment carries, what breaks when packets are lost, and what the handshake costs in latency and server memory.",
  blocks: [
    {
      id: "c-why",
      type: "concept",
      title: "Why TCP needs a handshake",
      sourceIds: [`${SRC}why-tcp-needs-a-handshake`, `${SRC}why-three-segments-and-not-two`],
      body:
        "IP can **drop, duplicate and reorder** packets. TCP hides that by numbering every byte it sends with a **sequence number**, so the receiver can put bytes in order and acknowledge exactly what arrived.\n\nThat only works if each side knows where the other side's numbering *starts*: its **Initial Sequence Number (ISN)**. The handshake is the exchange that synchronizes both ISNs before any application data flows.",
      analogy:
        "A phone call on a bad line: \"Can you hear me?\" — \"Yes, I hear you. Can you hear me?\" — \"Yes.\" Each person needs proof that their own voice got through, not just that they heard the other side.",
      keyPoints: [
        "Sequence numbers make a lossy network look like an ordered byte stream.",
        "Each direction has its own ISN, so both must be confirmed.",
        "No application data is sent until the handshake completes (without Fast Open).",
      ],
      narration:
        "IP can drop, duplicate and reorder packets. TCP fixes that by numbering every byte. But both sides first need to agree where the numbering starts. That agreement is the handshake.",
    },
    {
      id: "s-handshake",
      type: "stepper",
      title: "Step through the handshake",
      sourceIds: [`${SRC}syn-syn-ack-ack`, `${SRC}lost-segments-and-retransmission`, `${SRC}why-three-segments-and-not-two`],
      description:
        "Play the exchange one segment at a time. Watch both endpoints' states and sequence numbers change. Switch scenarios to see a lost packet and a stale duplicate SYN.",
      lanes: [
        { id: "client", label: "Client" },
        { id: "server", label: "Server" },
      ],
      scenarios: [
        {
          id: "happy",
          label: "Normal open",
          steps: [
            {
              from: "client",
              to: "server",
              label: "SYN  seq=x",
              detail: "The client picks its ISN x and sends a segment with the SYN flag. It moves from CLOSED to SYN-SENT. The SYN carries no data but still consumes one sequence number.",
              status: "neutral",
              state: { "client.state": "SYN-SENT", "server.state": "LISTEN", "client.seq": "x", "server.seq": "—" },
            },
            {
              from: "server",
              to: "client",
              label: "SYN-ACK  seq=y ack=x+1",
              detail: "The server picks its own ISN y, sets SYN and ACK, and acknowledges the client's SYN with ack = x + 1 (next byte it expects). It moves to SYN-RECEIVED and holds half-open state.",
              status: "neutral",
              state: { "client.state": "SYN-SENT", "server.state": "SYN-RECEIVED", "client.seq": "x", "server.seq": "y" },
            },
            {
              from: "client",
              to: "server",
              label: "ACK  ack=y+1",
              detail: "The client acknowledges the server's SYN with ack = y + 1 and is now ESTABLISHED. It may send request data with or right after this ACK.",
              status: "ok",
              state: { "client.state": "ESTABLISHED", "server.state": "SYN-RECEIVED", "client.seq": "x+1", "server.seq": "y" },
            },
            {
              from: "client",
              to: "server",
              label: "DATA  seq=x+1",
              detail: "When the final ACK arrives the server moves to ESTABLISHED. Both directions are synchronized: client bytes start at x+1, server bytes start at y+1.",
              status: "ok",
              state: { "client.state": "ESTABLISHED", "server.state": "ESTABLISHED", "client.seq": "x+1", "server.seq": "y+1" },
            },
          ],
        },
        {
          id: "loss",
          label: "SYN-ACK lost",
          steps: [
            {
              from: "client",
              to: "server",
              label: "SYN  seq=x",
              detail: "Same opening SYN. The client starts a retransmission timer.",
              status: "neutral",
              state: { "client.state": "SYN-SENT", "server.state": "LISTEN", "client.timer": "RTO 1s", "server.seq": "—" },
            },
            {
              from: "server",
              to: "client",
              label: "SYN-ACK  ✕ dropped",
              detail: "The server replies but the segment is lost in the network. The server sits in SYN-RECEIVED holding state; the client hears nothing.",
              status: "error",
              state: { "client.state": "SYN-SENT", "server.state": "SYN-RECEIVED", "client.timer": "running", "server.seq": "y" },
            },
            {
              from: "client",
              to: "server",
              label: "SYN (retransmit)",
              detail: "With no round-trip sample yet, RFC 6298 recommends a 1 second initial RTO. The timer fires, the client resends the SYN and doubles the timeout (exponential backoff). One lost packet just cost ~1 s, far more than an RTT.",
              status: "error",
              state: { "client.state": "SYN-SENT", "server.state": "SYN-RECEIVED", "client.timer": "RTO 2s", "server.seq": "y" },
            },
            {
              from: "server",
              to: "client",
              label: "SYN-ACK  seq=y ack=x+1",
              detail: "The server recognizes the duplicate SYN and resends its SYN-ACK.",
              status: "neutral",
              state: { "client.state": "SYN-SENT", "server.state": "SYN-RECEIVED", "client.timer": "running", "server.seq": "y" },
            },
            {
              from: "client",
              to: "server",
              label: "ACK  ack=y+1",
              detail: "Handshake completes, about one RTO later than the normal case.",
              status: "ok",
              state: { "client.state": "ESTABLISHED", "server.state": "ESTABLISHED", "client.timer": "stopped", "server.seq": "y+1" },
            },
          ],
        },
        {
          id: "stale",
          label: "Stale duplicate SYN",
          steps: [
            {
              from: "client",
              to: "server",
              label: "old SYN  seq=z (delayed)",
              detail: "A SYN from an earlier, abandoned connection attempt finally arrives after wandering in the network.",
              status: "error",
              state: { "client.state": "SYN-SENT (expects x)", "server.state": "LISTEN" },
            },
            {
              from: "server",
              to: "client",
              label: "SYN-ACK  ack=z+1",
              detail: "The server can't tell the SYN is stale, so it answers it.",
              status: "neutral",
              state: { "client.state": "SYN-SENT (expects x)", "server.state": "SYN-RECEIVED" },
            },
            {
              from: "client",
              to: "server",
              label: "RST",
              detail: "The client sees ack = z+1 but its current SYN was x. That acknowledgment is wrong, so it sends a reset. This third step is exactly what a two-way handshake would be missing: the initiator gets to reject a connection it never asked for.",
              status: "ok",
              state: { "client.state": "SYN-SENT", "server.state": "LISTEN" },
            },
          ],
        },
      ],
      narration: "Press play and I'll walk through each segment.",
    },
    {
      id: "p-two-way",
      type: "predict",
      title: "Predict: could two segments be enough?",
      sourceIds: [`${SRC}why-three-segments-and-not-two`],
      question: "Suppose TCP stopped after SYN and SYN-ACK. What would go wrong?",
      options: [
        "Nothing; the third ACK is just a courtesy",
        "The server would never learn that its own ISN reached the client, and stale SYNs could open bogus connections",
        "The client would not know the server's IP address",
        "Data would be sent unencrypted",
      ],
      correctIndex: 1,
      explanation:
        "Each direction is synchronized separately. The third segment is the client confirming the server's ISN (ack = y+1). It's also the moment the client can reject a SYN-ACK for a connection it never requested, which blocks old duplicate SYNs.",
    },
    {
      id: "a-states",
      type: "architecture",
      title: "The connection state machine",
      sourceIds: [`${SRC}connection-states`, `${SRC}simultaneous-open`],
      description:
        "Drag the states around and click any state or transition for details. Then finish the diagram: two transitions into ESTABLISHED are missing.",
      nodes: [
        { id: "closed", label: "CLOSED", x: 0, y: 120, detail: "No connection exists. An application either listens (server) or connects (client) to leave this state." },
        { id: "listen", label: "LISTEN", x: 220, y: 0, detail: "Server is waiting for a SYN on a port. No per-client state is allocated yet." },
        { id: "synsent", label: "SYN-SENT", x: 220, y: 240, detail: "Client has sent its SYN and is waiting for a SYN-ACK. A retransmission timer is running." },
        { id: "synrcvd", label: "SYN-RECEIVED", x: 460, y: 0, detail: "Server has answered a SYN and is holding a half-open connection in its SYN backlog until the final ACK arrives. This is the state a SYN flood fills up." },
        { id: "est", label: "ESTABLISHED", x: 680, y: 120, detail: "Both ISNs are acknowledged. Data flows in both directions." },
      ],
      edges: [
        { id: "e1", source: "closed", target: "listen", label: "passive open", detail: "Server calls listen() on a socket." },
        { id: "e2", source: "closed", target: "synsent", label: "send SYN", detail: "Client calls connect(); the stack picks an ISN and sends SYN." },
        { id: "e3", source: "listen", target: "synrcvd", label: "rcv SYN / snd SYN-ACK", detail: "Server allocates half-open state, picks its ISN y, and replies with SYN-ACK (ack = x+1)." },
        { id: "e4", source: "synsent", target: "synrcvd", label: "simultaneous open", detail: "Rare: both sides sent SYNs at once. Each sees the other's SYN while in SYN-SENT and moves to SYN-RECEIVED, completing in four segments instead of three.", status: "error" },
      ],
      challenge: {
        prompt: "Draw the two missing transitions into ESTABLISHED (drag from a state's right handle to another state's left handle).",
        requiredEdges: [
          { source: "synsent", target: "est" },
          { source: "synrcvd", target: "est" },
        ],
        successMessage:
          "Correct. The client reaches ESTABLISHED when it receives the SYN-ACK and sends its ACK; the server reaches ESTABLISHED when that final ACK arrives.",
      },
    },
    {
      id: "sl-latency",
      type: "slider",
      title: "What the handshake costs",
      sourceIds: [`${SRC}latency-cost-of-the-handshake`, `${SRC}lost-segments-and-retransmission`],
      description:
        "Move the sliders to see how round-trip time and packet loss turn into user-visible delay before the first response byte.",
      params: [
        { name: "rtt", label: "Round-trip time", min: 5, max: 300, step: 5, default: 80, unit: "ms" },
        { name: "loss", label: "Packet loss", min: 0, max: 30, step: 1, default: 0, unit: "%" },
        { name: "rto", label: "Initial retransmission timeout", min: 200, max: 3000, step: 100, default: 1000, unit: "ms" },
      ],
      outputs: [
        { label: "First response byte, no loss", expr: "2 * rtt", unit: "ms", decimals: 0, goodWhen: "2 * rtt < 150", badWhen: "2 * rtt > 400" },
        {
          label: "Expected setup delay (one-retry model)",
          expr: "rtt + (1 - (1 - loss / 100) ^ 2) * rto",
          unit: "ms",
          decimals: 0,
          goodWhen: "rtt + (1 - (1 - loss / 100) ^ 2) * rto < 120",
          badWhen: "rtt + (1 - (1 - loss / 100) ^ 2) * rto > 400",
        },
        { label: "Wasted on handshakes: 10 requests without keep-alive", expr: "9 * rtt", unit: "ms", decimals: 0, badWhen: "9 * rtt > 500" },
      ],
      chart: { x: "loss", outputIndex: 1 },
      insight:
        "Loss hurts far more than distance: a lost SYN or SYN-ACK costs a whole RTO (1 s by default), not one RTT. That's why clients reuse connections (keep-alive, pools) and why TCP Fast Open lets returning clients put data in the SYN.",
    },
    {
      id: "code-cookie",
      type: "code",
      title: "Trace a server under a SYN flood",
      sourceIds: [`${SRC}syn-floods-and-syn-cookies`],
      language: "python",
      code: [
        "def on_syn(seg):",
        "    if backlog.is_full():",
        "        # stateless path: encode the connection in our ISN",
        "        isn = syn_cookie(seg.src, seg.sport, seg.dst, seg.dport, time_slot(), seg.mss)",
        "        send_syn_ack(seq=isn, ack=seg.seq + 1)",
        "        return                      # nothing stored",
        "    conn = backlog.add_half_open(seg)",
        "    send_syn_ack(seq=conn.isn, ack=seg.seq + 1)",
        "",
        "def on_ack(seg):",
        "    if backlog.has(seg):",
        "        return establish(backlog.pop(seg))",
        "    if seg.ack - 1 == syn_cookie(seg.src, seg.sport, seg.dst, seg.dport, recent_slot(), ...):",
        "        return establish_from_cookie(seg)   # rebuilt from the number",
        "    send_rst(seg)",
      ].join("\n"),
      trace: [
        { line: 1, vars: { "backlog": "126/128", "seg.src": "spoofed 203.0.113.9" }, note: "An attacker floods SYNs from spoofed addresses. None of them will ever ACK.", status: "error" },
        { line: 7, vars: { "backlog": "127/128" }, note: "Normal path: each SYN allocates a half-open entry while we wait for the final ACK.", status: "neutral" },
        { line: 2, vars: { "backlog": "128/128 FULL" }, note: "The SYN backlog is full. Without cookies, new legitimate clients would now be refused.", status: "error" },
        { line: 4, vars: { "isn": "cookie(addrs, ports, slot, mss)" }, note: "Instead of storing state, the server encodes the connection parameters into the ISN it sends back.", status: "neutral" },
        { line: 6, vars: { "backlog": "128/128 (unchanged)" }, note: "Nothing is stored for this SYN, so the flood can't exhaust memory.", status: "ok" },
        { line: 13, vars: { "seg.ack": "isn + 1", "valid": "true" }, note: "A real client's final ACK carries isn + 1. The server recomputes the cookie and checks it.", status: "neutral" },
        { line: 14, vars: { "conn": "ESTABLISHED" }, note: "The connection is rebuilt from the number alone. Trade-off: some options negotiated in the SYN can't be fully preserved.", status: "ok" },
      ],
    },
    {
      id: "c-edge",
      type: "concept",
      title: "Edge cases worth knowing",
      sourceIds: [`${SRC}initial-sequence-number-selection`, `${SRC}simultaneous-open`, `${SRC}latency-cost-of-the-handshake`],
      body:
        "- **ISNs are unpredictable on purpose.** Modern stacks mix a clock with a keyed hash of the addresses and ports, so an off-path attacker can't guess numbers to inject forged segments.\n- **Simultaneous open** works: both sides send SYNs, both pass through SYN-RECEIVED, and the connection opens in four segments.\n- **The handshake is a latency tax.** Every new connection pays at least one RTT before the request goes out; TLS adds more. Connection reuse and TCP Fast Open exist to avoid paying it repeatedly.",
      keyPoints: [
        "Unpredictable ISNs defend against injection and confusion with old connections.",
        "Half-open state is the attack surface for SYN floods.",
        "Reusing connections is the main way to avoid the handshake's cost.",
      ],
    },
  ],
};

/** Parsed through the same schema the real agents must satisfy. */
export const tcpLesson: LessonDraft = LessonDraft.parse(rawLesson);

export interface FixtureRubricItem extends RubricItem {
  misconceptions?: { pattern: string; note: string }[];
}

const rawRubric: FixtureRubricItem[] = [
  {
    id: "r-purpose",
    concept: "Purpose of the handshake",
    expectation: "Explains that both sides synchronize initial sequence numbers before data flows so TCP can order and acknowledge bytes.",
    keywords: ["sequence number", "isn", "synchroni", "both sides", "starting number", "in order"],
    tier: "easy",
    blockId: "c-why",
  },
  {
    id: "r-steps",
    concept: "SYN → SYN-ACK → ACK",
    expectation: "Names the three segments in order and who sends each.",
    keywords: ["syn-ack", "syn ack", "synack", "then ack", "final ack", "three"],
    tier: "easy",
    blockId: "s-handshake",
  },
  {
    id: "r-ack",
    concept: "ACK numbers are ISN + 1",
    expectation: "States that each side acknowledges the other's ISN + 1 because a SYN consumes one sequence number.",
    keywords: ["+1", "+ 1", "plus one", "next byte", "consume", "one more"],
    tier: "medium",
    blockId: "s-handshake",
    misconceptions: [{ pattern: "ack(nowledg\\w*)?( number)? (is|=|equals) (the )?same", note: "Says the ACK number equals the ISN instead of ISN + 1." }],
  },
  {
    id: "r-three",
    concept: "Why three segments, not two",
    expectation: "Explains that the server needs confirmation its ISN arrived, and the third step lets the client reject stale duplicate SYNs.",
    keywords: ["both direction", "confirm", "server never", "doesn't know", "old", "stale", "duplicate", "reset", "rst"],
    tier: "medium",
    blockId: "p-two-way",
    misconceptions: [{ pattern: "(two|2)[- ](way|segments?|messages?) (is|are|would be) (enough|fine)", note: "Claims a two-way exchange would be sufficient." }],
  },
  {
    id: "r-loss",
    concept: "Lost segments and retransmission",
    expectation: "Describes the retransmission timer: a lost SYN or SYN-ACK is resent after an RTO (about 1 s initially) with exponential backoff.",
    keywords: ["retransmi", "resend", "timeout", "rto", "timer", "backoff", "1 second", "one second"],
    tier: "medium",
    blockId: "sl-latency",
  },
  {
    id: "r-flood",
    concept: "SYN floods and SYN cookies",
    expectation: "Explains half-open connections fill the backlog under a spoofed SYN flood, and SYN cookies encode state in the ISN so the server stores nothing.",
    keywords: ["half-open", "half open", "backlog", "queue", "cookie", "spoof", "stateless", "no state"],
    tier: "difficult",
    blockId: "code-cookie",
    misconceptions: [{ pattern: "(bigger|larger|increase).{0,20}(backlog|queue).{0,30}(fix|solve)", note: "Believes a bigger backlog alone solves SYN floods." }],
  },
  {
    id: "r-latency",
    concept: "Latency cost of the handshake",
    expectation: "Explains the handshake costs at least one RTT per new connection and why reuse (keep-alive, pools) or TCP Fast Open helps.",
    keywords: ["rtt", "round trip", "round-trip", "keep-alive", "keepalive", "reuse", "pool", "fast open"],
    tier: "difficult",
    blockId: "sl-latency",
  },
];

/** Validated like real Archivist output (misconception patterns are fixture-only). */
export const tcpRubric: FixtureRubricItem[] = rawRubric.map((r) => ({ ...RubricItemSchema.parse(r), misconceptions: r.misconceptions }));

/** Pupil question bank: one question per rubric item per difficulty tier. */
export const tcpPupilQuestions: Record<string, Record<Difficulty, string>> = {
  "r-purpose": {
    easy: "Wait, why do they need to shake hands at all? Couldn't the client just start sending data?",
    medium: "What would actually break if the client started sending bytes before the server knew its starting number?",
    difficult: "Couldn't both sides just start counting from zero and skip the whole number-swapping thing? Seems simpler.",
  },
  "r-steps": {
    easy: "Okay so who sends what first? Can you walk me through the three messages?",
    medium: "What's in the second message exactly? Is it one segment or two separate ones?",
    difficult: "Couldn't the server just send its SYN and its ACK as separate packets? Why are they combined?",
  },
  "r-ack": {
    easy: "When the server acknowledges, what number does it send back?",
    medium: "Why is the ACK number one more than the sequence number if the SYN didn't carry any data?",
    difficult: "I think the ACK just echoes the same sequence number back, right? Like a receipt with the same ID?",
  },
  "r-three": {
    easy: "Why three messages? Wouldn't two be enough?",
    medium: "What happens if an old SYN from a previous attempt shows up late at the server?",
    difficult: "Honestly two messages seems fine to me: client asks, server says yes, done. Why isn't that enough?",
  },
  "r-loss": {
    easy: "What if one of the messages gets lost?",
    medium: "What happens if the SYN-ACK is dropped? How long does the client wait before doing something?",
    difficult: "If packets get lost, wouldn't it be faster to just retry the SYN immediately every few milliseconds?",
  },
  "r-flood": {
    easy: "Can someone abuse this handshake somehow?",
    medium: "What happens to the server if lots of clients send SYNs but never send the last ACK?",
    difficult: "Wouldn't making the SYN backlog really big just fix SYN floods? Why do we need anything fancier?",
  },
  "r-latency": {
    easy: "Does the handshake make things slower?",
    medium: "If the round-trip time is 100 ms, how long until the first byte of the response arrives on a new connection?",
    difficult: "Why don't browsers just open a fresh TCP connection for every single request? That seems cleaner.",
  },
};

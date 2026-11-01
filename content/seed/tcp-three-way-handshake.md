---
title: TCP Three-Way Handshake (seed notes)
repo: ietf/rfc9293
url: https://www.rfc-editor.org/rfc/rfc9293
---

# TCP Three-Way Handshake

## Why TCP needs a handshake
<!-- source: https://www.rfc-editor.org/rfc/rfc9293#section-3.5 -->
TCP gives applications a reliable, ordered byte stream on top of IP, which can drop, duplicate or reorder packets. To do that, each side numbers every byte it sends with a sequence number. Before any application data flows, both endpoints must learn the other side's starting sequence number (the Initial Sequence Number, ISN) and agree that a connection exists. The three-way handshake is the exchange that synchronizes those numbers in both directions.

## SYN, SYN-ACK, ACK
<!-- source: https://www.rfc-editor.org/rfc/rfc9293#section-3.5 -->
1. The client sends a segment with the SYN flag set and its own ISN, call it x. The client moves to SYN-SENT.
2. The server, which was in LISTEN, replies with a segment that has both SYN and ACK set. It carries the server's own ISN y and acknowledges the client's SYN with ack = x + 1. The server moves to SYN-RECEIVED.
3. The client acknowledges the server's SYN with ack = y + 1 and moves to ESTABLISHED. When the server receives this ACK it also moves to ESTABLISHED.

A SYN consumes one sequence number even though it carries no data, which is why each acknowledgment is ISN + 1. After the handshake, data from the client starts at x + 1 and data from the server starts at y + 1.

## Why three segments and not two
<!-- source: https://www.rfc-editor.org/rfc/rfc9293#section-3.5 -->
Each direction of a TCP connection is synchronized independently: the client must learn y and the server must learn that the client received y. With only two segments, the server would never get confirmation that its ISN arrived. The RFC also gives a second reason: a three-way exchange stops old, delayed duplicate SYNs from an earlier connection from opening a bogus new connection. If a stale SYN reaches the server, the server's SYN-ACK acknowledges a sequence number the client does not expect, so the client answers with a RST instead of completing the handshake.

## Initial sequence number selection
<!-- source: https://www.rfc-editor.org/rfc/rfc9293#section-3.4.1 -->
ISNs are not zero and not simply sequential. Modern stacks derive the ISN from a clock combined with a keyed hash of the connection's addresses and ports (the approach described in RFC 6528). This makes sequence numbers hard to guess, which protects against off-path attackers injecting forged segments, and it keeps segments from a recently closed connection on the same ports from being mistaken for the new one.

## Connection states
<!-- source: https://www.rfc-editor.org/rfc/rfc9293#section-3.3.2 -->
The handshake moves each endpoint through a small state machine. Client: CLOSED → SYN-SENT → ESTABLISHED. Server: CLOSED → LISTEN → SYN-RECEIVED → ESTABLISHED. A server in SYN-RECEIVED has allocated state for a half-open connection; it is waiting for the final ACK. Many operating systems keep these half-open connections in a separate SYN backlog queue that has a fixed size.

## Lost segments and retransmission
<!-- source: https://www.rfc-editor.org/rfc/rfc6298#section-2 -->
SYN and SYN-ACK segments can be lost like any other packet. The sender starts a retransmission timer; RFC 6298 recommends an initial retransmission timeout (RTO) of one second when no round-trip measurement exists yet, and the timeout doubles after each expiry (exponential backoff). A single lost SYN therefore adds roughly a full second of delay to connection setup, which is far larger than a typical round-trip time.

## Latency cost of the handshake
<!-- source: https://www.rfc-editor.org/rfc/rfc7413#section-1 -->
The client cannot send request data until it has received the SYN-ACK, so every new TCP connection costs at least one round-trip time (RTT) before the first byte of the request is sent, and the response arrives no earlier than two RTTs after the first SYN. On a 100 ms RTT path that is 200 ms before the first response byte, before TLS adds its own round trips. This is why clients reuse connections (HTTP keep-alive, connection pools) and why TCP Fast Open lets a returning client carry data in the SYN using a cookie from an earlier connection.

## SYN floods and SYN cookies
<!-- source: https://www.rfc-editor.org/rfc/rfc4987#section-3 -->
Because the server stores state after receiving a SYN, an attacker can send a flood of SYNs from spoofed addresses and never complete the handshake. The half-open connections fill the SYN backlog and legitimate clients are refused. One widely deployed defence is SYN cookies: when the backlog is full, the server encodes the connection parameters into its own ISN and keeps no state. A legitimate client's final ACK returns that number (plus one), letting the server rebuild the connection. The trade-off is that some TCP options negotiated in the SYN cannot be fully preserved.

## Simultaneous open
<!-- source: https://www.rfc-editor.org/rfc/rfc9293#section-3.5 -->
Rarely, both endpoints send a SYN to each other at the same time. Each side moves from SYN-SENT to SYN-RECEIVED when it sees the other's SYN, then each acknowledges the other, and both reach ESTABLISHED after four segments instead of three. TCP handles this case without special application logic.

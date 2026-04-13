// Design Ref: §4 — Federation (Hyperswarm P2P, embedding-only sharing)
// Extracted from server.ts for modular architecture.

import { Router } from 'express';
import type { VectorStore } from '../../store/types.js';
import type { PeerInfo } from '../../federation/types.js';

/** Minimal FederationNode shape (actual class is dynamically imported) */
interface FederationNodeLike {
  isRunning: boolean;
  displayName: string;
  peerId: string;
  peerCount: number;
  getPeers(): PeerInfo[];
  setLocalStats(count: number, topics: string[]): void;
  join(): Promise<void>;
  leave(): Promise<void>;
}

export function createFederationRouter(store: VectorStore): Router {
  const router = Router();

  let federationNode: FederationNodeLike | null = null;
  let federationAvailable: boolean | null = null;

  async function probeFederationAvailable(): Promise<boolean> {
    if (federationAvailable !== null) return federationAvailable;
    try {
      await import('hyperswarm');
      federationAvailable = true;
    } catch {
      federationAvailable = false;
    }
    return federationAvailable;
  }

  router.get('/status', async (_req, res) => {
    const available = await probeFederationAvailable();
    if (!available) {
      return res.json({ available: false, active: false, peerCount: 0, peers: [], displayName: null, peerId: null });
    }
    if (!federationNode || !federationNode.isRunning) {
      return res.json({ available: true, active: false, peerCount: 0, peers: [], displayName: null, peerId: null });
    }
    try {
      const peers = federationNode.getPeers().map(p => ({
        peerId: p.peerId || '',
        displayName: p.displayName || 'Peer',
        documentCount: p.documentCount ?? 0,
        topTopics: p.topTopics ?? [],
      }));
      res.json({
        available: true,
        active: true,
        peerCount: peers.length,
        peers,
        displayName: federationNode.displayName,
        peerId: federationNode.peerId,
      });
    } catch (err) {
      console.error(err);
      res.json({ available: true, active: false, peerCount: 0, peers: [], displayName: null, peerId: null });
    }
  });

  router.post('/join', async (req, res) => {
    const available = await probeFederationAvailable();
    if (!available) {
      return res.status(501).json({
        success: false,
        error: 'federation-unavailable',
        message: 'Federation requires optional dependency "hyperswarm". Reinstall stellavault with hyperswarm enabled.',
      });
    }
    if (federationNode && federationNode.isRunning) {
      return res.json({
        success: true,
        active: true,
        displayName: federationNode.displayName,
        peerId: federationNode.peerId,
        peerCount: federationNode.peerCount,
        message: 'Already joined',
      });
    }
    try {
      const { FederationNode } = await import('../../federation/index.js');
      const displayName = (req.body?.displayName as string) || undefined;
      federationNode = new FederationNode(displayName);

      try {
        const stats = await store.getStats();
        federationNode.setLocalStats(stats.documentCount ?? 0, []);
      } catch { /* non-fatal */ }

      await federationNode.join();
      res.json({
        success: true,
        active: true,
        displayName: federationNode.displayName,
        peerId: federationNode.peerId,
        peerCount: federationNode.peerCount,
      });
    } catch (err: unknown) {
      console.error('Federation join failed:', err);
      federationNode = null;
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Federation join failed' });
    }
  });

  router.post('/leave', async (_req, res) => {
    if (!federationNode || !federationNode.isRunning) {
      return res.json({ success: true, active: false, message: 'Not active' });
    }
    try {
      await federationNode.leave();
      federationNode = null;
      res.json({ success: true, active: false });
    } catch (err: unknown) {
      console.error('Federation leave failed:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Federation leave failed' });
    }
  });

  return router;
}

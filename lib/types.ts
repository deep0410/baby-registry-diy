// Shared types for the registry.

export interface Claim {
  slot: number;
  purchaserName: string;
  message: string;
  purchasedFrom: string;
  claimedAt: string;
  byAdmin?: boolean;
}

// What the public site sees about an item (no purchaser details).
export interface PublicItem {
  id: string;
  name: string;
  url: string;
  imageUrl: string; // resolved url the browser can load
  quantity: number;
  remaining: number; // units still needed
  taken: number; // units claimed or on active hold
  soldOut: boolean;
}

// What the admin sees (everything).
export interface AdminItem {
  id: string;
  name: string;
  url: string;
  imageUrl: string;
  imageKey?: string;
  quantity: number;
  remaining: number;
  claimed: number; // confirmed purchases
  held: number; // active (unconfirmed) holds
  archived: boolean;
  createdAt: string;
  claims: Claim[];
}

export interface ReserveResult {
  ok: boolean;
  slot?: number;
  reason?: string;
}

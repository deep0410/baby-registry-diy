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
  price: string; // display-ready, e.g. "$129.99" (may be empty)
  quantity: number;
  remaining: number; // units still needed
  taken: number; // units claimed or on active hold
  soldOut: boolean;
  // If true, the site's tax multiplier is NOT applied to this item's price.
  // Defaults to false (taxed) for any item that predates this field.
  taxExempt: boolean;
}

// What the admin sees (everything).
export interface AdminItem {
  id: string;
  name: string;
  url: string;
  imageUrl: string;
  imageKey?: string;
  price: string;
  quantity: number;
  remaining: number;
  claimed: number; // confirmed purchases
  held: number; // active (unconfirmed) holds
  archived: boolean;
  createdAt: string;
  claims: Claim[];
  // If true, the site's tax multiplier is NOT applied to this item's price.
  taxExempt: boolean;
}

export interface ReserveResult {
  ok: boolean;
  slot?: number;
  reason?: string;
}

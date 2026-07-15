// UI types for the client app. IDs are Supabase UUIDs (strings) — the data
// layer in src/lib/api.ts maps backend rows into these shapes.

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  lat: string;
  lng: string;
  phone: string;
  logoUrl: string | null;
  coverUrl: string | null;
  category: string;
  rating: string;
  deliveryTime: string;
  deliveryFee: string;
  isOpen: number;
  createdAt: number;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string | null;
  category: string;
  isAvailable: number;
  createdAt: number;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string | null;
  restaurantId: string;
  restaurantName: string;
  courierId: string | null;
  status: string;
  pickupAddress: string;
  deliveryAddress: string;
  items: string;
  totalAmount: string;
  deliveryFee: string;
  notes: string | null;
  createdAt: number;
}

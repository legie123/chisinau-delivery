export interface Restaurant {
  id: number;
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
  id: number;
  restaurantId: number;
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
  id: number;
  customerName: string;
  customerPhone: string | null;
  restaurantId: number;
  restaurantName: string;
  courierId: number | null;
  status: string;
  pickupAddress: string;
  deliveryAddress: string;
  items: string;
  totalAmount: string;
  deliveryFee: string;
  notes: string | null;
  createdAt: number;
}

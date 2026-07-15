import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { CartItem } from '../types';

interface Props {
  route: any;
  navigation: any;
}

export default function CartScreen({ route, navigation }: Props) {
  const { cart: initialCart, restaurant } = route.params;
  const [cart, setCart] = useState<CartItem[]>(initialCart);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.menuItem.id === itemId) {
        const newQty = c.quantity + delta;
        return newQty > 0 ? { ...c, quantity: newQty } : c;
      }
      return c;
    }).filter(c => c.quantity > 0));
  };

  const removeItem = (itemId: string) => {
    setCart(prev => prev.filter(c => c.menuItem.id !== itemId));
  };

  const subtotal = cart.reduce((sum, c) => sum + c.quantity * parseFloat(c.menuItem.price), 0);
  const deliveryFee = restaurant.deliveryFee === '0' ? 0 : parseFloat(restaurant.deliveryFee || '7.99');
  const total = subtotal + deliveryFee;

  const placeOrder = () => {
    if (!deliveryAddress.trim()) {
      Alert.alert('Adresă necesară', 'Te rugăm să introduci adresa de livrare.');
      return;
    }
    Alert.alert(
      '✅ Comandă plasată!',
      `Comanda ta de ${total.toFixed(2)} MDL de la ${restaurant.name} a fost trimisă. Vei primi o notificare când restaurantul o acceptă.`,
      [{ text: 'OK', onPress: () => navigation.popToTop() }]
    );
  };

  if (cart.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <Ionicons name="bag-outline" size={64} color={COLORS.textMuted} />
        <Text style={styles.emptyText}>Coșul tău este gol</Text>
        <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.emptyBtnText}>Înapoi la meniu</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Coșul tău</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Restaurant info */}
        <View style={styles.restaurantInfo}>
          <Text style={styles.restaurantEmoji}>🐉</Text>
          <View>
            <Text style={styles.restaurantName}>{restaurant.name}</Text>
            <Text style={styles.restaurantCategory}>{restaurant.category}</Text>
          </View>
        </View>

        {/* Cart Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Produse comandate</Text>
          {cart.map(item => (
            <View key={item.menuItem.id} style={styles.cartItem}>
              <View style={styles.cartItemInfo}>
                <Text style={styles.cartItemName}>{item.menuItem.name}</Text>
                <Text style={styles.cartItemPrice}>{parseFloat(item.menuItem.price) * item.quantity} MDL</Text>
              </View>
              <View style={styles.quantityRow}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQuantity(item.menuItem.id, -1)}>
                  <Ionicons name="remove" size={16} color={COLORS.white} />
                </TouchableOpacity>
                <Text style={styles.qtyText}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQuantity(item.menuItem.id, 1)}>
                  <Ionicons name="add" size={16} color={COLORS.white} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.removeBtn} onPress={() => removeItem(item.menuItem.id)}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Delivery Address */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Adresă livrare</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="location" size={20} color={COLORS.primary} />
            <TextInput
              style={styles.input}
              placeholder="Str. Victoriei 45, Sector 1, București"
              placeholderTextColor={COLORS.textMuted}
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
            />
          </View>
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Note pentru curier</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Ex: Etaj 3, Apartament 12, Interfon 12"
            placeholderTextColor={COLORS.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        {/* Price Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sumar comandă</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Subtotal</Text>
            <Text style={styles.priceValue}>{subtotal.toFixed(2)} MDL</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Livrare</Text>
            <Text style={[styles.priceValue, deliveryFee === 0 && { color: COLORS.success }]}>
              {deliveryFee === 0 ? 'GRATIS' : `${deliveryFee.toFixed(2)} MDL`}
            </Text>
          </View>
          <View style={[styles.priceRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{total.toFixed(2)} MDL</Text>
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Place Order Button */}
      <TouchableOpacity style={styles.orderBtn} activeOpacity={0.9} onPress={placeOrder}>
        <Ionicons name="bag-check" size={20} color={COLORS.white} />
        <Text style={styles.orderBtnText}>Plasează comanda · {total.toFixed(2)} MDL</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  emptyText: {
    fontSize: 18,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  emptyBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  restaurantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
    padding: 14,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  restaurantEmoji: {
    fontSize: 32,
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  restaurantCategory: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cartItem: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cartItemInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cartItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
    flex: 1,
  },
  cartItemPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gold,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    minWidth: 20,
    textAlign: 'center',
  },
  removeBtn: {
    marginLeft: 'auto',
    padding: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: COLORS.white,
  },
  notesInput: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  priceLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  priceValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.white,
  },
  totalValue: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.gold,
  },
  orderBtn: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  orderBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
  },
});

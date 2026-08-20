'use client';

/**
 * The single client-side store for Kepler Coffee: cart, orders, currency.
 *
 * ## Hydration
 *
 * `localStorage` does not exist during server rendering, so the server and the
 * first client render both start from the *same* empty defaults — no mismatch,
 * no React hydration error. A mount effect then loads the stored state and flips
 * `hydrated` to true.
 *
 * Screens must not render an empty state while `hydrated` is false. If `/cart`
 * printed "Your cart is empty" for one frame before the stored cart arrived, a
 * browser-driven assertion could photograph that frame and fail intermittently.
 * So every stored-state screen renders an explicit `aria-busy` loading region
 * until `hydrated`, and only then commits to lines-or-empty. The window is one
 * synchronous effect tick, but it is a *deterministic* window.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { addItem, setQuantity, type CartAddition, type CartLine } from '../lib/cart';
import { DEFAULT_CURRENCY, isCurrencyCode, type CurrencyCode } from '../lib/currency';
import { createOrder, type DeliveryDetails, type Order } from '../lib/orders';
import { read, STORAGE_KEYS, write } from '../lib/storage';

interface StoreValue {
  /** False until the mount effect has read `localStorage`. */
  readonly hydrated: boolean;
  readonly cart: readonly CartLine[];
  readonly orders: readonly Order[];
  readonly currency: CurrencyCode;
  addToCart: (product: CartAddition, qty?: number) => void;
  setLineQuantity: (slug: string, qty: number) => void;
  removeLine: (slug: string) => void;
  clearCart: () => void;
  placeOrder: (details: DeliveryDetails) => Order | null;
  chooseCurrency: (code: CurrencyCode) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Partial<CartLine>;
  return (
    typeof line.slug === 'string' &&
    typeof line.name === 'string' &&
    typeof line.price === 'number' &&
    typeof line.qty === 'number'
  );
}

function isOrder(value: unknown): value is Order {
  if (typeof value !== 'object' || value === null) return false;
  const order = value as Partial<Order>;
  return (
    typeof order.id === 'string' &&
    typeof order.placedAt === 'string' &&
    typeof order.total === 'number' &&
    Array.isArray(order.lines)
  );
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [orders, setOrders] = useState<readonly Order[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);

  // Load once, on mount. Anything unrecognisable in storage is discarded rather
  // than rendered, so a hand-edited key cannot break a screen.
  useEffect(() => {
    const storedCart = read<unknown>(STORAGE_KEYS.cart, []);
    if (Array.isArray(storedCart)) setCart(storedCart.filter(isCartLine));

    const storedOrders = read<unknown>(STORAGE_KEYS.orders, []);
    if (Array.isArray(storedOrders)) setOrders(storedOrders.filter(isOrder));

    const storedCurrency = read<unknown>(STORAGE_KEYS.currency, DEFAULT_CURRENCY);
    if (isCurrencyCode(storedCurrency)) setCurrency(storedCurrency);

    setHydrated(true);
  }, []);

  // Persist after hydration only. Writing before the load would overwrite a
  // returning shopper's cart with the empty default.
  useEffect(() => {
    if (hydrated) write(STORAGE_KEYS.cart, cart);
  }, [cart, hydrated]);

  useEffect(() => {
    if (hydrated) write(STORAGE_KEYS.orders, orders);
  }, [orders, hydrated]);

  useEffect(() => {
    if (hydrated) write(STORAGE_KEYS.currency, currency);
  }, [currency, hydrated]);

  const addToCart = useCallback((product: CartAddition, qty = 1) => {
    setCart((current) => addItem(current, product, qty));
  }, []);

  const setLineQuantity = useCallback((slug: string, qty: number) => {
    setCart((current) => setQuantity(current, slug, qty));
  }, []);

  const removeLine = useCallback((slug: string) => {
    setCart((current) => setQuantity(current, slug, 0));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const placeOrder = useCallback(
    (details: DeliveryDetails): Order | null => {
      if (cart.length === 0) return null;
      const order = createOrder(orders, cart, details, new Date().toISOString());
      setOrders([...orders, order]);
      setCart([]);
      return order;
    },
    [cart, orders],
  );

  const chooseCurrency = useCallback((code: CurrencyCode) => {
    setCurrency(code);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      hydrated,
      cart,
      orders,
      currency,
      addToCart,
      setLineQuantity,
      removeLine,
      clearCart,
      placeOrder,
      chooseCurrency,
    }),
    [
      hydrated,
      cart,
      orders,
      currency,
      addToCart,
      setLineQuantity,
      removeLine,
      clearCart,
      placeOrder,
      chooseCurrency,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (value === null) {
    throw new Error('useStore must be used inside <StoreProvider>');
  }
  return value;
}

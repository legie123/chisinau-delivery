import { CartView } from "@/components/customer/CartView";

export default function CartPage() {
  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Coșul tău</h1>
      <CartView />
    </main>
  );
}

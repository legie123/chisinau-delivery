import { ActivateForm } from "./ActivateForm";

// Portal activation: the admin's invite email (invitePartner) lands here. No server data —
// the session is in the URL fragment, consumed client-side by ActivateForm.
export default function RestaurantActivarePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-10">
      <h1 className="mb-2 font-serif text-2xl font-semibold pg-gold-text">Activează panoul</h1>
      <p className="mb-6 max-w-sm text-center text-sm text-white/60">
        Setează o parolă pentru contul tău de partener. Cu ea te vei autentifica de acum înainte.
      </p>
      <ActivateForm />
    </main>
  );
}

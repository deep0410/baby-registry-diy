import RegistryClient from "./RegistryClient";

export const dynamic = "force-dynamic";

export default function Home() {
  const tax = parseFloat(process.env.NEXT_PUBLIC_TAX_MULTIPLIER || "1.13");
  return (
    <RegistryClient
      title={process.env.NEXT_PUBLIC_REGISTRY_TITLE || "Baby Patel"}
      subtitle={process.env.NEXT_PUBLIC_REGISTRY_SUBTITLE || "We're having a baby!"}
      taxMultiplier={Number.isFinite(tax) && tax > 0 ? tax : 1.13}
      houseAddress={process.env.HOUSE_ADDRESS || ""}
    />
  );
}

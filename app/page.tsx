import RegistryClient from "./RegistryClient";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <RegistryClient
      title={process.env.NEXT_PUBLIC_REGISTRY_TITLE || "Baby Patel"}
      subtitle={process.env.NEXT_PUBLIC_REGISTRY_SUBTITLE || "We're having a baby!"}
    />
  );
}

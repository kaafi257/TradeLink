/** The official TradeLink logo (storefront-T mark, wordmark and tagline). Assets live in public/brand; the light variant is the same artwork recoloured for navy backgrounds. */
export function LogoMark({ size = 44, light = false }: { size?: number; light?: boolean }) {
  return <img className="brand-mark" src={`/brand/logo-mark${light ? "-light" : ""}.png`} height={size} width={Math.round(size * 1.17)} alt="TradeLink" decoding="async" />;
}

export function Brand({ light = false }: { light?: boolean }) {
  const v = light ? "-light" : "";
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <img className="brand-full" src={`/brand/logo-full${v}.png`} width="180" height="45" alt="TradeLink — Wholesale and retail in one place" decoding="async" />
      <img className="brand-mark brand-mark-only" src={`/brand/logo-mark${v}.png`} width="46" height="39" alt="" aria-hidden="true" decoding="async" />
    </div>
  );
}

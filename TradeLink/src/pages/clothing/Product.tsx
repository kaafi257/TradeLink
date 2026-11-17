import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Shirt } from "lucide-react";
import { ContactPills } from "../../components/ContactActions";
import { optionText, useFashion } from "./store";
import { BuyBox, Gallery, Price, ProductGrid, useReveal } from "./parts";

export default function Product() {
  const { id } = useParams();
  const f = useFashion();
  const p = id ? f.byId.get(id) : undefined;

  useEffect(() => {
    if (!p) return;
    const before = document.title;
    document.title = `${p.name}${p.brand ? ` · ${p.brand}` : ""} | TradeLink Fashion`;
    return () => { document.title = before; };
  }, [p]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [id]);

  const related = p
    ? [...f.products.filter(x => x.id !== p.id && x.category_id === p.category_id), ...f.products.filter(x => x.id !== p.id && x.category_id !== p.category_id)].slice(0, 4)
    : [];
  useReveal(`${id}:${related.length}`);

  if (f.status === "loading") return <main className="fx-main fx-pdp"><div className="fx-skel" aria-busy="true" /></main>;
  if (!p) {
    return (
      <main className="fx-main fx-pdp">
        <div className="fx-empty"><Shirt size={34} /><p>We could not find that product</p><Link className="fx-btn line" to="/clothing#catalogue">Back to the collection</Link></div>
      </main>
    );
  }

  const cartLine = f.cart.find(l => l.productId === p.id);
  const ask = `Hello TradeLink, I am interested in ${p.name}${cartLine ? ` (${optionText(cartLine)})` : ""}.`;
  return (
    <main className="fx-main fx-pdp">
      <nav className="fx-crumbs" aria-label="Breadcrumb">
        <Link to="/clothing">Clothing</Link><ChevronRight size={14} />
        <Link to={`/clothing?cat=${p.category_id}#catalogue`}>{f.catName(p)}</Link><ChevronRight size={14} />
        <span aria-current="page">{p.name}</span>
      </nav>
      <div className="fx-pdp-grid">
        <Gallery photos={f.photos(p)} name={p.name} />
        <div className="fx-pdp-info">
          {p.brand && <small className="fx-brand">{p.brand}</small>}
          <h1>{p.name}</h1>
          <Price p={p} big />
          {p.description && <p className="fx-desc">{p.description}</p>}
          <BuyBox p={p} />
          <div className="fx-ask"><span>Questions? Ask us</span><ContactPills message={ask} /></div>
          <dl className="fx-facts">
            <div><dt>Category</dt><dd>{f.catName(p)}</dd></div>
            {p.package_size && <div><dt>Details</dt><dd>{p.package_size}</dd></div>}
          </dl>
        </div>
      </div>
      {related.length > 0 && (
        <section className="fx-section" aria-labelledby="rel">
          <div className="fx-head" data-rv=""><div><small>You may also like</small><h2 id="rel">Related Products</h2></div></div>
          <ProductGrid items={related} />
        </section>
      )}
    </main>
  );
}

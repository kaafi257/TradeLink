import { useState } from "react";
import { Mail, MapPin, MessageCircle, Phone, Send, X } from "lucide-react";
import { useChannels, useContact, type Channel } from "../lib/contact";

export type { Channel };
const Icon = ({ k, size = 20 }: { k: Channel["key"]; size?: number }) =>
  k === "whatsapp" ? <MessageCircle size={size} /> : k === "telegram" ? <Send size={size} /> : <Phone size={size} />;
const ext = (c: Channel) => (c.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** Small round buttons, for the product showcase. */
export function ContactIcons({ message }: { message?: string }) {
  const list = useChannels(message);
  if (!list.length) return null;
  return (
    <div className="contact-icons">
      {list.map(c => (
        <a key={c.key} className={`ci ci-${c.key}`} href={c.href} title={c.label} aria-label={c.label} {...ext(c)}><Icon k={c.key} size={17} /></a>
      ))}
    </div>
  );
}

/** Labelled buttons (WhatsApp / Telegram / Call) so customers can see how to reach us. Used on product cards. */
export function ContactPills({ message, title }: { message?: string; title?: string }) {
  const list = useChannels(message);
  if (!list.length) return null;
  return (
    <div className="contact-pills-wrap">
      {title && <small>{title}</small>}
      <div className="contact-pills">
        {list.map(c => (
          <a key={c.key} className={`pill pill-${c.key}`} href={c.href} {...ext(c)}><Icon k={c.key} size={15} />{c.label}</a>
        ))}
      </div>
    </div>
  );
}

/** Large cards for the Contact section. */
export function ContactCards({ message }: { message?: string }) {
  const list = useChannels(message);
  if (!list.length) return null;
  return (
    <div className="contact-cards">
      {list.map(c => (
        <a key={c.key} className={`contact-card cc-${c.key}`} href={c.href} title={c.label} aria-label={c.label} {...ext(c)}>
          <span className="cc-icon"><Icon k={c.key} size={22} /></span>
        </a>
      ))}
    </div>
  );
}

/** Always-visible round buttons at the screen edge. */
export function FloatingContact() {
  const list = useChannels();
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <div className={`fab-stack${open ? " open" : ""}`} aria-label="Contact us">
      {/* On phones the channels fold into one button so they never cover products. */}
      <button type="button" className="fab fab-toggle" aria-expanded={open} aria-label={open ? "Close contact options" : "Contact us"} onClick={() => setOpen(o => !o)}>
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
      {list.map(c => (
        <a key={c.key} className={`fab fab-${c.key}`} href={c.href} title={c.label} aria-label={c.label} {...ext(c)}><Icon k={c.key} size={20} /></a>
      ))}
    </div>
  );
}

/** One row of every way to reach us, as icons only (chat channels, email, map). */
export function ContactRow() {
  const list = useChannels();
  const c = useContact();
  const maps = c.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}` : "";
  if (!list.length && !c.email && !maps) return null;
  return (
    <div className="contact-icons contact-row">
      {list.map(ch => (
        <a key={ch.key} className={`ci ci-${ch.key}`} href={ch.href} title={ch.label} aria-label={ch.label} {...ext(ch)}><Icon k={ch.key} size={18} /></a>
      ))}
      {c.email && <a className="ci ci-mail" href={`mailto:${c.email}`} title="Email" aria-label="Email"><Mail size={18} /></a>}
      {maps && <a className="ci ci-map" href={maps} target="_blank" rel="noopener noreferrer" title="Map" aria-label="Map"><MapPin size={18} /></a>}
    </div>
  );
}

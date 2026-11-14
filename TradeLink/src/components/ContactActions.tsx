import { MessageCircle, Phone, Send } from "lucide-react";
import { CONTACT } from "../config";

export type Channel = { key: "whatsapp" | "telegram" | "call"; label: string; detail: string; href: string; external: boolean };

const digits = (v: string) => v.replace(/[^\d]/g, "");
const username = (v: string) => v.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").trim();

/** Only channels that are configured are returned, so there are never dead buttons. */
export function channels(message = "Hello TradeLink, I would like a wholesale price."): Channel[] {
  const out: Channel[] = [];
  if (CONTACT.whatsapp) {
    out.push({ key: "whatsapp", label: "WhatsApp", detail: CONTACT.whatsapp, external: true,
      href: `https://wa.me/${digits(CONTACT.whatsapp)}?text=${encodeURIComponent(message)}` });
  }
  if (CONTACT.telegram) {
    out.push({ key: "telegram", label: "Telegram", detail: `@${username(CONTACT.telegram)}`, external: true,
      href: `https://t.me/${username(CONTACT.telegram)}` });
  }
  if (CONTACT.phone) {
    out.push({ key: "call", label: "Call", detail: CONTACT.phone, external: false, href: `tel:${CONTACT.phone.replace(/[^\d+]/g, "")}` });
  }
  return out;
}

export const hasContact = channels().length > 0;
const Icon = ({ k, size = 20 }: { k: Channel["key"]; size?: number }) =>
  k === "whatsapp" ? <MessageCircle size={size} /> : k === "telegram" ? <Send size={size} /> : <Phone size={size} />;

/** Small round buttons, for product cards and the showcase. */
export function ContactIcons({ message }: { message?: string }) {
  const list = channels(message);
  if (!list.length) return null;
  return (
    <div className="contact-icons">
      {list.map(c => (
        <a key={c.key} className={`ci ci-${c.key}`} href={c.href} title={`${c.label}: ${c.detail}`} aria-label={c.label}
           {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          <Icon k={c.key} size={17} />
        </a>
      ))}
    </div>
  );
}

/** Large cards for the Contact section. */
export function ContactCards({ message }: { message?: string }) {
  const list = channels(message);
  if (!list.length) return null;
  return (
    <div className="contact-cards">
      {list.map(c => (
        <a key={c.key} className={`contact-card cc-${c.key}`} href={c.href}
           {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          <span className="cc-icon"><Icon k={c.key} size={24} /></span>
          <span><b>{c.key === "call" ? "Call us" : `Chat on ${c.label}`}</b><small>{c.detail}</small></span>
        </a>
      ))}
    </div>
  );
}

/** Always-visible round buttons at the screen edge. */
export function FloatingContact() {
  const list = channels();
  if (!list.length) return null;
  return (
    <div className="fab-stack" aria-label="Contact us">
      {list.map(c => (
        <a key={c.key} className={`fab fab-${c.key}`} href={c.href} title={`${c.label}: ${c.detail}`} aria-label={c.label}
           {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          <Icon k={c.key} size={24} />
        </a>
      ))}
    </div>
  );
}

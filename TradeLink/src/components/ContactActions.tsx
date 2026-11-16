import { MessageCircle, Phone, Send } from "lucide-react";
import { useChannels, type Channel } from "../lib/contact";

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
  if (!list.length) return null;
  return (
    <div className="fab-stack" aria-label="Contact us">
      {list.map(c => (
        <a key={c.key} className={`fab fab-${c.key}`} href={c.href} title={c.label} aria-label={c.label} {...ext(c)}><Icon k={c.key} size={20} /></a>
      ))}
    </div>
  );
}

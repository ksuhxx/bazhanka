import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, niceDate } from '../api.js';
import { useSession } from '../session.jsx';

const emptyItem = { url: '', title: '', imageUrl: '', price: '', currency: 'UAH', note: '', chipIn: false };

export default function ListPage() {
  const { slug } = useParams();
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api(`/lists/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  // Reload when the session changes (signed out -> signed in shows "reserved by me").
  useEffect(() => { if (user !== undefined) load(); }, [load, user]);

  if (error) return <div className="page"><h1>Oops</h1><p>{error}</p><Link to="/">Go home</Link></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return data.isOwner ? <OwnerView data={data} reload={load} /> : <GuestView data={data} reload={load} />;
}

function Header({ w, children }) {
  return (
    <div className="list-header">
      <span className="tag">{w.occasion || 'Wishlist'}</span>
      <h1>{w.title}</h1>
      <p className="muted">{w.ownerName}’s wishlist{w.eventDate ? ` · ${niceDate(w.eventDate)}` : ''}</p>
      {children}
    </div>
  );
}

function ItemMedia({ item }) {
  return item.imageUrl ? (
    <img className="item-img" src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
  ) : <div className="item-img ph">🎁</div>;
}

// ---------------- Owner ----------------

function OwnerView({ data, reload }) {
  const w = data.wishlist;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null); // item id or 'new'
  const shareUrl = `${window.location.origin}/l/${w.slug}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  const removeList = async () => {
    if (!confirm('Delete this wishlist and all its items? Friends who reserved gifts will lose them too.')) return;
    await api(`/wishlists/${w.id}`, { method: 'DELETE' });
    navigate('/dashboard');
  };
  const removeItem = async (id) => {
    if (!confirm('Remove this item? Someone may have already reserved it.')) return;
    await api(`/items/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div className="page">
      <Header w={w} />
      <div className="card share">
        <div>
          <strong>Share this link with friends</strong>
          <p className="muted small">Guests see which gifts are taken. You won’t — so the surprise stays a surprise. 🤫</p>
        </div>
        <div className="share-row">
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <a className="btn ghost" target="_blank" rel="noreferrer"
            href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`My wishlist: ${w.title} 🎁`)}`}>Telegram</a>
        </div>
      </div>

      <div className="row between">
        <h2>Items ({data.items.length})</h2>
        {editing !== 'new' && <button className="btn" onClick={() => setEditing('new')}>+ Add item</button>}
      </div>

      {editing === 'new' && (
        <ItemForm wishlistId={w.id} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      )}

      {data.items.length === 0 && editing !== 'new' && (
        <div className="card empty"><p>Your list is empty. Paste a link from Rozetka, Prom, Makeup, Yakaboo or any other shop — we’ll fill in the rest.</p></div>
      )}

      <div className="items">
        {data.items.map((it) => editing === it.id ? (
          <ItemForm key={it.id} item={it} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        ) : (
          <div key={it.id} className="card item">
            <ItemMedia item={it} />
            <div className="item-body">
              <h3>{it.title}</h3>
              {it.price !== null && <div className="price">{money(it.price, it.currency)}</div>}
              {it.chipIn && <span className="tag">🤝 Chip-in gift</span>}
              {it.note && <p className="note">{it.note}</p>}
              <div className="row">
                {it.url && <a href={it.url} target="_blank" rel="noreferrer">Open in shop ↗</a>}
                <button className="link" onClick={() => setEditing(it.id)}>Edit</button>
                <button className="link danger" onClick={() => removeItem(it.id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="center"><button className="link danger" onClick={removeList}>Delete this wishlist</button></p>
    </div>
  );
}

function ItemForm({ wishlistId, item, onDone, onCancel }) {
  const [f, setF] = useState(item ? { ...emptyItem, ...item, price: item.price ?? '', imageUrl: item.imageUrl || '', url: item.url || '', note: item.note || '' } : emptyItem);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const fetchPreview = async (url) => {
    if (!/^https?:\/\//i.test(url)) return;
    setStatus('loading');
    setError('');
    try {
      const { preview } = await api('/preview', { method: 'POST', body: { url } });
      setF((cur) => ({
        ...cur,
        url: preview.url || url,
        title: cur.title || preview.title || '',
        imageUrl: cur.imageUrl || preview.image || '',
        price: cur.price || preview.price || '',
        currency: preview.currency || cur.currency,
      }));
      setStatus(preview.blocked ? (preview.title ? 'blocked' : 'failed') : preview.title ? 'ok' : 'partial');
    } catch (err) {
      setStatus('failed');
      setError(err.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (item) await api(`/items/${item.id}`, { method: 'PATCH', body: f });
      else await api(`/wishlists/${wishlistId}/items`, { method: 'POST', body: f });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card stack item-form" onSubmit={save}>
      <label>
        Shop link
        <input type="url" value={f.url} placeholder="https://rozetka.com.ua/…" onChange={set('url')}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); setTimeout(() => fetchPreview(t.trim()), 0); }}
          onBlur={() => !item && !f.title && fetchPreview(f.url)} autoFocus={!item} />
        <small className="muted">
          {status === 'loading' ? 'Looking up the product…' : status === 'ok' ? 'Filled in from the shop ✓ — check it below.' :
            status === 'partial' ? 'The shop shared only part of the details — please complete them.' :
            status === 'blocked' ? 'This shop doesn\'t let us read its pages — we guessed the name from the link, please check it and add the price.' :
            status === 'failed' ? 'Could not read that page — fill the item in by hand.' : 'Paste a link and we fill in title, photo and price.'}
        </small>
      </label>
      {f.imageUrl && <img className="preview-img" src={f.imageUrl} alt="" referrerPolicy="no-referrer" />}
      <label>Title<input required value={f.title} onChange={set('title')} placeholder="What do you want?" /></label>
      <div className="grid2">
        <label>Price<input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="e.g. 1200" /></label>
        <label>Currency
          <select value={f.currency} onChange={set('currency')}>{['UAH', 'EUR', 'USD', 'PLN', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select>
        </label>
      </div>
      <label>Photo link (optional)<input type="url" value={f.imageUrl} onChange={set('imageUrl')} /></label>
      <label>Note for friends (optional)<textarea rows={2} value={f.note} onChange={set('note')} placeholder="Size M, any colour except yellow" /></label>
      <label className="check"><input type="checkbox" checked={f.chipIn} onChange={set('chipIn')} /> Let several friends chip in on this gift</label>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="btn">{item ? 'Save' : 'Add to list'}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

// ---------------- Guest ----------------

function GuestView({ data, reload }) {
  const w = data.wishlist;
  const { user } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(null);

  const needSignIn = () => navigate(`/signup?next=${encodeURIComponent(`/l/${w.slug}`)}`);

  const act = async (it, method, body) => {
    if (!user) return needSignIn();
    setError('');
    setBusy(it.id);
    try {
      await api(`/items/${it.id}/reserve`, { method, body });
      reload();
    } catch (err) {
      setError(err.message);
      reload();
    } finally {
      setBusy(null);
    }
  };

  const available = data.items.filter((i) => !i.reserved).length;

  return (
    <div className="page">
      <Header w={w}>
        <p className="hint">🤫 Reservations are secret: {w.ownerName} won’t see who is giving what, but other guests will see an item as taken — so nobody buys the same thing twice.</p>
      </Header>
      {error && <p className="error">{error}</p>}
      {data.items.length === 0 && <div className="card empty"><p>{w.ownerName} hasn’t added any items yet. Check back soon!</p></div>}
      {data.items.length > 0 && <p className="muted">{available} of {data.items.length} gifts still open</p>}
      <div className="items">
        {data.items.map((it) => {
          const takenByOther = it.reserved && !it.reservedByMe && !it.chipIn;
          const pct = it.chip && it.price ? Math.min(100, Math.round((it.chip.total / it.price) * 100)) : 0;
          return (
            <div key={it.id} className={`card item ${takenByOther ? 'taken' : ''}`}>
              <ItemMedia item={it} />
              <div className="item-body">
                <h3>{it.title}</h3>
                {it.price !== null && <div className="price">{money(it.price, it.currency)}</div>}
                {it.note && <p className="note">{it.note}</p>}
                {it.url && <a href={it.url} target="_blank" rel="noreferrer">Open in shop ↗</a>}

                {it.chipIn ? (
                  <div className="chip">
                    <div className="progress"><div style={{ width: `${pct}%` }} /></div>
                    <small className="muted">
                      {money(it.chip.total, it.currency)}{it.price ? ` of ${money(it.price, it.currency)}` : ''} collected · {it.chip.people} {it.chip.people === 1 ? 'person' : 'people'}
                      {it.chip.mine > 0 && ` · you: ${money(it.chip.mine, it.currency)}`}
                    </small>
                    <form className="row" onSubmit={(e) => { e.preventDefault(); act(it, 'POST', { amount: amounts[it.id] }); }}>
                      <input className="amount" inputMode="decimal" required placeholder={it.chip.mine ? String(it.chip.mine) : 'Amount'}
                        value={amounts[it.id] || ''} onChange={(e) => setAmounts({ ...amounts, [it.id]: e.target.value })} />
                      <button className="btn" disabled={busy === it.id}>{it.chip.mine ? 'Change my part' : 'Chip in'}</button>
                      {it.chip.mine > 0 && <button type="button" className="link danger" onClick={() => act(it, 'DELETE')}>Leave</button>}
                    </form>
                  </div>
                ) : it.reservedByMe ? (
                  <div className="row">
                    <span className="status mine">✓ You’re giving this</span>
                    <button className="link danger" disabled={busy === it.id} onClick={() => act(it, 'DELETE')}>Cancel reservation</button>
                  </div>
                ) : takenByOther ? (
                  <span className="status">Already reserved by someone</span>
                ) : (
                  <button className="btn" disabled={busy === it.id} onClick={() => act(it, 'POST')}>I’ll gift this</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card cta">
        <h3>Want friends to know what to get you?</h3>
        <p>Make your own wishlist in a minute and share one link.</p>
        <Link className="btn" to={user ? '/dashboard' : `/signup?next=/dashboard`}>Create my wishlist</Link>
      </div>
    </div>
  );
}

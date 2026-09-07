import { useState, useEffect, useRef } from 'react';

export default function PartSearch({ parts = [], value, onSelect, placeholder = 'Type to search parts...' }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Sync input text when value prop changes (e.g. form reset)
  useEffect(() => {
    if (value === '' || value === null || value === undefined) {
      setQuery('');
    } else {
      const selected = parts.find(p => String(p.id) === String(value));
      if (selected) {
        setQuery(`${selected.part_number} - ${selected.description}`);
      }
    }
  }, [value, parts]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter parts based on query
  const filtered = query && !parts.find(p => `${p.part_number} - ${p.description}` === query)
    ? parts.filter(p => {
        const q = query.toLowerCase();
        return p.part_number.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      })
    : isOpen && !query
      ? parts
      : [];

  // Reset highlight when results change
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && listRef.current.children[highlightIndex]) {
      listRef.current.children[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const selectPart = (part) => {
    setQuery(`${part.part_number} - ${part.description}`);
    setIsOpen(false);
    onSelect(part);
  };

  const clearSelection = () => {
    setQuery('');
    setIsOpen(false);
    onSelect({ id: '' });
    inputRef.current?.focus();
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setIsOpen(true);
    if (!e.target.value) {
      onSelect({ id: '' });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && filtered[highlightIndex]) {
        selectPart(filtered[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const hasSelection = value && value !== '';

  return (
    <div className="part-search" ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {hasSelection && (
        <button type="button" className="part-search-clear" onClick={clearSelection} title="Clear selection">&times;</button>
      )}
      {isOpen && filtered.length > 0 && (
        <div className="part-search-dropdown" ref={listRef}>
          {filtered.map((p, i) => (
            <div
              key={p.id}
              className={`part-search-option${i === highlightIndex ? ' highlighted' : ''}`}
              onMouseEnter={() => setHighlightIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); selectPart(p); }}
            >
              <strong>{p.part_number}</strong> — {p.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

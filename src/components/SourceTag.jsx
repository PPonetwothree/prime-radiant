import React from 'react';

// Small label saying who runs an outlet (state media, exile media, ...).
const SourceTag = ({ type, label, note }) => {
  if (!type || !label) return null;
  return (
    <span className={`src-tag src-${type}`} title={note || label}>
      {label}
    </span>
  );
};

export default SourceTag;

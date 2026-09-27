/* ---------- SYNC SLIDER ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const mapSlider = document.getElementById('vr-slider-map');
  const shopSlider = document.getElementById('vr-slider-shop');
  const valLabel  = document.getElementById('vr-radius-val');

  const update = e => {
    const r = e.target.value;
    valLabel.textContent = `${r/1000} km`;
    // sincroniza visualmente
    if (e.target.id === 'vr-slider-map') shopSlider.value = r;
    else mapSlider.value = r;
  };

  if (mapSlider) mapSlider.addEventListener('input', update);
  if (shopSlider) shopSlider.addEventListener('input', update);
});
import { useEffect, useState } from 'react';
import { catchStorage } from '../storage';
import { db } from '../db';
import { goBack } from '../router';
import type { Food, Nutrients, Unit } from '../types';
import { fmtKcal, kcalFromMacros, scale } from '../lib/nutrition';
import { NumberField, Segmented, TextField } from '../components/Field';
import { setPendingPick } from '../components/FoodPicker';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';

type Basis = '100' | 'serving';
type Values = Partial<Record<keyof Nutrients, number>>;

const OPTIONAL: { key: keyof Nutrients; label: string }[] = [
  { key: 'fiber', label: 'Fibra' },
  { key: 'sugar', label: 'Azúcares' },
  { key: 'saturatedFat', label: 'Grasas saturadas' },
  { key: 'salt', label: 'Sal' },
];

/** Create or edit a food from the numbers on its label. */
export function FoodFormPage({ id, barcode, pick }: { id?: number; barcode?: string; pick: boolean }) {
  const [loaded, setLoaded] = useState(id === undefined);
  const [original, setOriginal] = useState<Food | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [code, setCode] = useState(barcode ?? '');
  const [unit, setUnit] = useState<Unit>('g');
  const [basis, setBasis] = useState<Basis>('100');
  const [servingSize, setServingSize] = useState<number | undefined>();
  const [servingLabel, setServingLabel] = useState('');
  const [values, setValues] = useState<Values>({});

  useEffect(() => {
    if (id === undefined) return;
    void db.foods.get(id).then((f) => {
      if (f) {
        setOriginal(f);
        setName(f.name);
        setBrand(f.brand ?? '');
        setCode(f.barcode ?? '');
        setUnit(f.unit);
        setServingSize(f.servingSize);
        setServingLabel(f.servingLabel ?? '');
        setValues({ ...f.per100 });
      }
      setLoaded(true);
    }).catch(catchStorage);
  }, [id]);

  const set = (key: keyof Nutrients) => (v: number | undefined) => setValues((prev) => ({ ...prev, [key]: v }));
  const fromMacros = kcalFromMacros(values.protein ?? 0, values.carbs ?? 0, values.fat ?? 0);
  const kcal = values.kcal ?? fromMacros;
  const needsServing = basis === 'serving' && !(servingSize && servingSize > 0);
  const valid = name.trim() !== '' && kcal > 0 && !needsServing;

  const switchBasis = (b: Basis) => {
    if (b === basis) return;
    // Convert what is already typed so switching never loses data.
    if (servingSize && servingSize > 0) {
      const factor = b === 'serving' ? servingSize / 100 : 100 / servingSize;
      setValues((prev) => {
        const next: Values = {};
        for (const [k, v] of Object.entries(prev)) if (v !== undefined) next[k as keyof Nutrients] = v * factor;
        return next;
      });
    }
    setBasis(b);
  };

  const save = async () => {
    const entered: Nutrients = {
      kcal,
      protein: values.protein ?? 0,
      carbs: values.carbs ?? 0,
      fat: values.fat ?? 0,
    };
    for (const o of OPTIONAL) {
      const v = values[o.key];
      if (v !== undefined) entered[o.key] = v;
    }
    const per100 = basis === 'serving' ? scale(entered, 10000 / servingSize!) : entered;
    const food: Food = {
      ...(original ?? { createdAt: Date.now() }),
      name: name.trim(),
      brand: brand.trim() || undefined,
      barcode: code.replace(/\D/g, '') || undefined,
      source: original?.source === 'recipe' ? 'recipe' : 'custom',
      unit,
      per100,
      servingSize: servingSize && servingSize > 0 ? servingSize : undefined,
      servingLabel: servingSize && servingSize > 0 ? servingLabel.trim() || undefined : undefined,
    };
    const savedId = id !== undefined ? (await db.foods.put({ ...food, id }), id) : ((await db.foods.add(food)) as number);
    toast(id !== undefined ? 'Alimento guardado' : 'Alimento creado');
    if (pick) setPendingPick(savedId);
    goBack('/foods');
  };

  const remove = async () => {
    if (!original || id === undefined) return;
    if (!confirm(`¿Eliminar «${original.name}»? Lo que ya registraste en el diario no cambia.`)) return;
    await db.foods.delete(id);
    toast('Alimento eliminado');
    goBack('/foods');
  };

  if (!loaded) return null;

  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" onClick={() => goBack('/foods')} aria-label="Volver">
          <Icon name="left" />
        </button>
        <h1>{id !== undefined ? 'Editar alimento' : 'Nuevo alimento'}</h1>
      </header>

      <section className="card form">
        <TextField label="Nombre" value={name} onChange={setName} placeholder="Pan integral" autoFocus={id === undefined} />
        <TextField label="Marca (opcional)" value={brand} onChange={setBrand} />
        <Segmented
          label="Unidad"
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'g', label: 'Sólido (g)' },
            { value: 'ml', label: 'Líquido (ml)' },
          ]}
        />
        <div className="grid-2">
          <NumberField label="Tamaño de porción" value={servingSize} onChange={setServingSize} suffix={unit} hint="Opcional" />
          <TextField label="Nombre de la porción" value={servingLabel} onChange={setServingLabel} placeholder="1 rebanada" />
        </div>
      </section>

      <section className="card form">
        <h2 className="card-title">Información nutricional</h2>
        <Segmented
          label="Valores por"
          value={basis}
          onChange={switchBasis}
          options={[
            { value: '100', label: `Por 100 ${unit}` },
            { value: 'serving', label: 'Por porción' },
          ]}
        />
        {needsServing && <p className="error small">Indica el tamaño de porción para usar valores por porción.</p>}
        <NumberField
          label="Calorías"
          value={values.kcal}
          onChange={set('kcal')}
          suffix="kcal"
          decimals={0}
          placeholder={fromMacros > 0 ? fmtKcal(fromMacros) : undefined}
          hint={values.kcal === undefined && fromMacros > 0 ? 'Se calcularán a partir de los macros' : undefined}
        />
        <div className="grid-3">
          <NumberField label="Proteína" value={values.protein} onChange={set('protein')} suffix="g" />
          <NumberField label="Carbohidratos" value={values.carbs} onChange={set('carbs')} suffix="g" />
          <NumberField label="Grasas" value={values.fat} onChange={set('fat')} suffix="g" />
        </div>
        <div className="grid-2">
          {OPTIONAL.map((o) => (
            <NumberField key={o.key} label={o.label} value={values[o.key]} onChange={set(o.key)} suffix="g" decimals={2} hint="Opcional" />
          ))}
        </div>
        <TextField label="Código de barras (opcional)" value={code} onChange={setCode} />
      </section>

      <div className="form-actions">
        {original && (
          <button className="btn btn-danger-ghost" onClick={() => void remove()}>
            <Icon name="trash" size={18} /> Eliminar
          </button>
        )}
        <button className="btn btn-primary btn-grow" disabled={!valid} onClick={() => void save()}>
          Guardar
        </button>
      </div>
    </div>
  );
}

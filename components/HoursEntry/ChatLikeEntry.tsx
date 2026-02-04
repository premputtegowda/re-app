'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Tag, Home, FileText, Zap, CheckCircle } from 'lucide-react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/UI/Button';
import { Input } from '@/components/UI/Input';
import { Card } from '@/components/UI/Card';
import { validateHoursEntry, getFieldError } from '@/utils/validationUtils';
import { getTodayDate } from '@/utils/dateUtils';
import type { HoursEntryFormData } from '@/types';

export function ChatLikeEntry() {
  const properties = useStore((s) => s.properties);
  const categories = useStore((s) => s.categories);
  const addEntry = useStore((s) => s.addEntry);
  const [step, setStep] = useState(1);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errors, setErrors] = useState<any[]>([]);

  const [formData, setFormData] = useState<HoursEntryFormData>({
    date: getTodayDate(),
    hours: 0,
    minutes: 0,
    category: '',
    property: '',
    description: '',
    type: 'material',
  });

  const descriptionRef = useRef<HTMLInputElement>(null);

  // Reset form after successful submission
  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
        setStep(1);
        setFormData({
          date: getTodayDate(),
          hours: 0,
          minutes: 0,
          category: '',
          property: '',
          description: '',
          type: 'material',
        });
        setErrors([]);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  const handlePropertySelect = (propertyId: string) => {
    setFormData({ ...formData, property: propertyId });
    setStep(2);
  };

  const handleCategorySelect = (categoryId: string) => {
    setFormData({ ...formData, category: categoryId });
    setStep(3);
  };

  const handleTimeSubmit = () => {
    if (formData.hours === 0 && formData.minutes === 0) {
      setErrors([{ field: 'hours', message: 'Please enter at least some time' }]);
      return;
    }
    setErrors([]);
    setStep(4);
  };

  const handleTypeSelect = (type: 'material' | 'non-material') => {
    setFormData({ ...formData, type });
    setStep(5);
    setTimeout(() => {
      descriptionRef.current?.focus();
    }, 100);
  };

  const handleSubmit = () => {
    console.log('Submit clicked with form data:', formData);
    const validation = validateHoursEntry(formData);
    console.log('Validation result:', validation);

    if (!validation.isValid) {
      console.error('Validation failed:', validation.errors);
      setErrors(validation.errors);
      return;
    }

    console.log('Validation passed, adding entry...');
    try {
      addEntry(formData);
      setShowSuccess(true);
      console.log('Entry submission complete');
    } catch (error) {
      console.error('Error during submission:', error);
      setErrors([{ field: 'general', message: 'Failed to save entry' }]);
    }
  };

  const quickHours = [0.5, 1, 2, 3, 4, 6, 8];
  const quickMinutes = [15, 30, 45];

  if (showSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl mx-auto mt-8"
      >
        <Card>
          <div className="text-center py-12">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.2 }}
              className="inline-flex items-center justify-center w-16 h-16 bg-secondary-100 dark:bg-secondary-900/30 rounded-full mb-4"
            >
              <CheckCircle className="text-secondary-600 dark:text-secondary-400" size={32} />
            </motion.div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Hours Logged!</h3>
            <p className="text-slate-600 dark:text-slate-400">Your entry has been saved successfully.</p>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto mt-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Log Your Hours</h2>
        <p className="text-slate-600 dark:text-slate-400">Quick and easy hours tracking with minimal typing</p>
      </motion.div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((s) => (
          <motion.div
            key={s}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: s * 0.1 }}
            className={`h-2 flex-1 rounded-full transition-all ${
              s <= step ? 'bg-primary-600' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </div>

      {/* Step 1: Select Property */}
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <Home className="text-primary-600 dark:text-primary-400" size={24} />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Which property?</h3>
                </div>

                {properties.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                    No properties available. Please add a property in Settings first.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {properties.map((property, index) => (
                      <motion.button
                        key={property.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => handlePropertySelect(property.id)}
                        className="text-left p-4 border-2 border-slate-200 dark:border-slate-600 rounded-lg hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all"
                      >
                        <p className="font-medium text-slate-900 dark:text-white">{property.name}</p>
                        {property.address && (
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{property.address}</p>
                        )}
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        )}

      {/* Step 2: Select Category */}
        {step === 2 && (
          <motion.div
            key="step-2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <Tag className="text-primary-600 dark:text-primary-400" size={24} />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">What category?</h3>
                </div>

                {categories.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                    No categories available. Please add a category in Settings first.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {categories.map((category, index) => (
                      <motion.button
                        key={category.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => handleCategorySelect(category.id)}
                        className="text-left p-4 border-2 border-slate-200 dark:border-slate-600 rounded-lg hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                          <p className="font-medium text-slate-900 dark:text-white">{category.name}</p>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}

                <Button variant="secondary" onClick={() => setStep(1)} fullWidth>
                  Back
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

      {/* Step 3: Enter Time */}
        {step === 3 && (
          <motion.div
            key="step-3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="text-primary-600 dark:text-primary-400" size={24} />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">How long?</h3>
                </div>

                {/* Quick hour buttons */}
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Quick select (hours):</p>
                  <div className="flex flex-wrap gap-2">
                    {quickHours.map((h) => (
                      <button
                        key={h}
                        onClick={() => setFormData({ ...formData, hours: h, minutes: 0 })}
                        className={`px-4 py-2 rounded-lg border-2 transition-all ${
                          formData.hours === h && formData.minutes === 0
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                            : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick minute buttons */}
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Quick select (minutes):</p>
                  <div className="flex flex-wrap gap-2">
                    {quickMinutes.map((m) => (
                      <button
                        key={m}
                        onClick={() => setFormData({ ...formData, hours: 0, minutes: m })}
                        className={`px-4 py-2 rounded-lg border-2 transition-all ${
                          formData.hours === 0 && formData.minutes === m
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                            : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom time input */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">Or enter custom time:</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      type="number"
                      label="Hours"
                      min="0"
                      max="24"
                      value={formData.hours}
                      onChange={(e) =>
                        setFormData({ ...formData, hours: parseInt(e.target.value) || 0 })
                      }
                      error={getFieldError(errors, 'hours')}
                    />
                    <Input
                      type="number"
                      label="Minutes"
                      min="0"
                      max="59"
                      value={formData.minutes}
                      onChange={(e) =>
                        setFormData({ ...formData, minutes: parseInt(e.target.value) || 0 })
                      }
                      error={getFieldError(errors, 'minutes')}
                    />
                  </div>
                </div>

                {/* Date selection */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <Input
                    type="date"
                    label="Date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    error={getFieldError(errors, 'date')}
                    fullWidth
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(2)} fullWidth>
                    Back
                  </Button>
                  <Button onClick={handleTimeSubmit} fullWidth>
                    Next
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

      {/* Step 4: Select Type */}
        {step === 4 && (
          <motion.div
            key="step-4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <Zap className="text-primary-600 dark:text-primary-400" size={24} />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">What type of work?</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    onClick={() => handleTypeSelect('material')}
                    className={`p-6 border-2 rounded-lg transition-all ${
                      formData.type === 'material'
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-4xl mb-2">🔨</div>
                      <p className="font-semibold text-slate-900 dark:text-white">Material Participation</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Active property management and operations
                      </p>
                    </div>
                  </motion.button>

                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    onClick={() => handleTypeSelect('non-material')}
                    className={`p-6 border-2 rounded-lg transition-all ${
                      formData.type === 'non-material'
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-slate-200 dark:border-slate-600 hover:border-primary-300 dark:hover:border-primary-500'
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-4xl mb-2">📋</div>
                      <p className="font-semibold text-slate-900 dark:text-white">Non-Material</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Administrative and planning work
                      </p>
                    </div>
                  </motion.button>
                </div>

                <Button variant="secondary" onClick={() => setStep(3)} fullWidth>
                  Back
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

      {/* Step 5: Add Description */}
        {step === 5 && (
          <motion.div
            key="step-5"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card>
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <FileText className="text-primary-600 dark:text-primary-400" size={24} />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add details</h3>
                </div>

                <Input
                  ref={descriptionRef}
                  type="text"
                  label="Description *"
                  placeholder="What did you do?"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  error={getFieldError(errors, 'description')}
                  fullWidth
                  required
                />

                {/* Summary */}
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-slate-900 dark:text-white mb-3">Summary:</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-slate-600 dark:text-slate-400">Property:</div>
                    <div className="font-medium text-slate-900 dark:text-white">
                      {properties.find((p) => p.id === formData.property)?.name}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">Category:</div>
                    <div className="font-medium text-slate-900 dark:text-white">
                      {categories.find((c) => c.id === formData.category)?.name}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">Time:</div>
                    <div className="font-medium text-slate-900 dark:text-white">
                      {formData.hours > 0 && `${formData.hours}h `}
                      {formData.minutes > 0 && `${formData.minutes}m`}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400">Type:</div>
                    <div className="font-medium text-slate-900 dark:text-white capitalize">{formData.type}</div>
                    <div className="text-slate-600 dark:text-slate-400">Date:</div>
                    <div className="font-medium text-slate-900 dark:text-white">{formData.date}</div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(4)} fullWidth>
                    Back
                  </Button>
                  <Button onClick={handleSubmit} fullWidth>
                    Save Entry
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

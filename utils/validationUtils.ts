import type { ValidationError, FormValidation, HoursEntryFormData, CategoryFormData, PropertyFormData } from '@/types';
import { isFutureDate, isValidDateFormat } from './dateUtils';

/**
 * Validate hours entry form data
 */
export const validateHoursEntry = (data: HoursEntryFormData): FormValidation => {
  const errors: ValidationError[] = [];

  // Validate date
  if (!data.date) {
    errors.push({ field: 'date', message: 'Date is required' });
  } else if (!isValidDateFormat(data.date)) {
    errors.push({ field: 'date', message: 'Invalid date format' });
  } else if (isFutureDate(data.date)) {
    errors.push({ field: 'date', message: 'Date cannot be in the future' });
  }

  // Validate hours and minutes
  if (data.hours < 0) {
    errors.push({ field: 'hours', message: 'Hours cannot be negative' });
  }

  if (data.minutes < 0) {
    errors.push({ field: 'minutes', message: 'Minutes cannot be negative' });
  }

  if (data.minutes >= 60) {
    errors.push({ field: 'minutes', message: 'Minutes must be less than 60' });
  }

  if (data.hours === 0 && data.minutes === 0) {
    errors.push({ field: 'hours', message: 'Total time must be greater than 0' });
  }

  // Validate category
  if (!data.category || data.category.trim() === '') {
    errors.push({ field: 'category', message: 'Category is required' });
  }

  // Validate property
  if (!data.property || data.property.trim() === '') {
    errors.push({ field: 'property', message: 'Property is required' });
  }

  // Validate description (required)
  if (!data.description || data.description.trim() === '') {
    errors.push({ field: 'description', message: 'Description is required' });
  } else if (data.description.length > 500) {
    errors.push({ field: 'description', message: 'Description must be 500 characters or less' });
  }

  // Validate type
  if (!data.type || (data.type !== 'material' && data.type !== 'non-material')) {
    errors.push({ field: 'type', message: 'Type must be either "material" or "non-material"' });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validate category form data
 */
export const validateCategory = (data: CategoryFormData, existingCategories: Array<{ name: string; id?: string }>, currentId?: string): FormValidation => {
  const errors: ValidationError[] = [];

  // Validate name
  if (!data.name || data.name.trim() === '') {
    errors.push({ field: 'name', message: 'Category name is required' });
  } else if (data.name.trim().length < 2) {
    errors.push({ field: 'name', message: 'Category name must be at least 2 characters' });
  } else if (data.name.trim().length > 50) {
    errors.push({ field: 'name', message: 'Category name must be 50 characters or less' });
  }

  // Check for duplicate names (case-insensitive)
  const duplicate = existingCategories.find(
    (cat) =>
      cat.name.toLowerCase() === data.name.trim().toLowerCase() &&
      cat.id !== currentId
  );
  if (duplicate) {
    errors.push({ field: 'name', message: 'A category with this name already exists' });
  }

  // Validate color
  if (!data.color || data.color.trim() === '') {
    errors.push({ field: 'color', message: 'Color is required' });
  } else if (!/^#[0-9A-F]{6}$/i.test(data.color)) {
    errors.push({ field: 'color', message: 'Invalid color format (must be hex color)' });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Validate property form data
 */
export const validateProperty = (data: PropertyFormData, existingProperties: Array<{ name: string; id?: string }>, currentId?: string): FormValidation => {
  const errors: ValidationError[] = [];

  // Validate name
  if (!data.name || data.name.trim() === '') {
    errors.push({ field: 'name', message: 'Property name is required' });
  } else if (data.name.trim().length < 2) {
    errors.push({ field: 'name', message: 'Property name must be at least 2 characters' });
  } else if (data.name.trim().length > 100) {
    errors.push({ field: 'name', message: 'Property name must be 100 characters or less' });
  }

  // Check for duplicate names (case-insensitive)
  const duplicate = existingProperties.find(
    (prop) =>
      prop.name.toLowerCase() === data.name.trim().toLowerCase() &&
      prop.id !== currentId
  );
  if (duplicate) {
    errors.push({ field: 'name', message: 'A property with this name already exists' });
  }

  // Validate address (optional)
  if (data.address && data.address.length > 200) {
    errors.push({ field: 'address', message: 'Address must be 200 characters or less' });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Get error message for a specific field
 */
export const getFieldError = (errors: ValidationError[], field: string): string | undefined => {
  const error = errors.find((e) => e.field === field);
  return error?.message;
};

/**
 * Check if a field has an error
 */
export const hasFieldError = (errors: ValidationError[], field: string): boolean => {
  return errors.some((e) => e.field === field);
};

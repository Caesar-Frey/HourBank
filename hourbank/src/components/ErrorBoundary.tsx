import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return (
        <View style={{ flex: 1, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 8 }}>
            Something went wrong
          </Text>
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, textAlign: 'center', marginBottom: 24 }}>
            {error.message}
          </Text>
          <TouchableOpacity
            onPress={this.reset}
            activeOpacity={0.7}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.oxblood, textDecorationLine: 'underline' }}>
              Try again
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

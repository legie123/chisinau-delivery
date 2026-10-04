import React from 'react';
import { View, Text } from 'react-native';

export default function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#3b0a14', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 }}>Aplicația nu este configurată</Text>
      <Text style={{ color: '#fecdd3', fontSize: 15 }}>{message}</Text>
    </View>
  );
}

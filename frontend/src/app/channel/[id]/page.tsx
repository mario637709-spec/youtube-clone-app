import ChannelClient from './ChannelClient';

export function generateStaticParams() {
  return [{ id: '1' }, { id: '2' }, { id: '3' }, { id: 'default' }];
}

export default function ChannelPage() {
  return <ChannelClient />;
}
